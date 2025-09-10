// src/lib/achievements/prealpha-winning-streak.ts
import type { IAchievement } from "../types";
import { AchievementCategory } from "../types";
import * as utils from "../utils/voi";

// ---------- naming ----------
const SERIES_NAME = "Got Good (Pre-Alpha)";
const SERIES_KEY  = "prealpha_winning_streak";

// ---------- logger ----------
const LP = "[ach:prealpha-winning-streak]";
const nowIso = () => new Date().toISOString();
const log = (msg: string, data?: Record<string, unknown>) =>
  data
    ? console.log(`${LP} ${nowIso()} ${msg}`, data)
    : console.log(`${LP} ${nowIso()} ${msg}`);

// ---------- External data sources ----------
const HOV_PLAYER_BASE =
  "https://voi-mainnet-mimirapi.nftnavigator.xyz/hov/players?appId=40879920";

// ---------- Network / contract helpers ----------
type Net = "mainnet" | "testnet";
type Network = Net | "localnet";

const getNetwork = (): Network => {
  const raw = (process.env.NETWORK || "").toLowerCase();
  if (raw === "mainnet" || raw === "testnet") {
    log("Resolved NETWORK", { net: raw });
    return raw;
  }
  log("Resolved NETWORK", { net: "localnet", from: raw || "(unset)" });
  return "localnet";
};

function getLocalAppIds(): Record<string, number> {
  const raw = process.env.LOCAL_APP_IDS;
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, number>;
    log("Loaded LOCAL_APP_IDS", { keys: Object.keys(obj).length });
    return obj;
  } catch {
    log("Failed to parse LOCAL_APP_IDS JSON");
    return {};
  }
}

interface TierDef {
  key: string;   // e.g., s3
  label: string; // e.g., 3
  streak: number; // threshold consecutive wins
  contractAppIds: { mainnet: number; testnet: number; localnet: number };
}

// 5 tiers: 3 → 15 consecutive wins
const TIERS: readonly TierDef[] = [
  { key: "s5",  label: "5",  streak: 5,  contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "s7",  label: "7",  streak: 7,  contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "s10",  label: "10",  streak: 10,  contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "s15", label: "15", streak: 15, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "s20", label: "20", streak: 20, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
] as const;

const fullIdForKey = (key: string) => `${SERIES_KEY}-${key}`;
const imageForKey  = (key: string) => `/achievements/${fullIdForKey(key)}.png`;

const findTierById = (id: string): TierDef | undefined => {
  const key = id.replace(new RegExp(`^${SERIES_KEY}-`), "");
  return TIERS.find((t) => t.key === key);
};

function getAppIdFor(id: string): number {
  const net = getNetwork();
  if (net === "localnet") {
    const localIds = getLocalAppIds();
    const appId = localIds[id] || 0;
    log("getAppIdFor(localnet)", { id, appId });
    return appId;
  }
  const tier = findTierById(id);
  const chainNet: "mainnet" | "testnet" = net;
  const appId = tier ? tier.contractAppIds[chainNet] ?? 0 : 0;
  log("getAppIdFor", { id, net: chainNet, appId });
  return appId;
}

// ---------- Fetch helpers ----------
async function fetchJson<T>(url: string, timeoutMs = 6000): Promise<T> {
  log("HTTP GET", { url });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    log("HTTP status", { url, status: res.status });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    return data;
  } finally {
    clearTimeout(t);
  }
}

// HOV API types
type HovPlayerRow = { longest_winning_streak?: number };
type HovPlayerResponse = HovPlayerRow[];

/**
 * Exported so the route can precompute once per request and pass via ctx (optional).
 */
export async function getLongestWinningStreak(address: string): Promise<number> {
  const url = `${HOV_PLAYER_BASE}&address=${encodeURIComponent(address)}`;
  try {
    const rows = await fetchJson<HovPlayerResponse>(url);
    let lw = 0;
    if (Array.isArray(rows) && rows.length > 0) {
      if (typeof rows[0]?.longest_winning_streak === "number") {
        lw = rows[0].longest_winning_streak;
      } else {
        for (const r of rows) {
          const v = typeof r?.longest_winning_streak === "number" ? r.longest_winning_streak : 0;
          if (v > lw) lw = v;
        }
      }
    }
    log("longest_winning_streak", { address, longest_winning_streak: lw });
    return Number.isFinite(lw) && lw > 0 ? lw : 0;
  } catch {
    log("HOV fetch failed for longest_winning_streak (treating as 0)", { url });
    return 0;
  }
}

// ---------- Requirement logic ----------
async function meetsLongestWinningStreak(
  account: string,
  threshold: number,
  ctx?: { longestWinningStreak?: number }
): Promise<{ eligible: boolean; progress: number }> {
  const current =
    typeof ctx?.longestWinningStreak === "number"
      ? ctx.longestWinningStreak
      : await getLongestWinningStreak(account);

  // cache once per request to avoid duplicate fetches across tiers
  if (ctx && typeof ctx.longestWinningStreak !== "number") {
    ctx.longestWinningStreak = current;
  }

  const eligible = current >= threshold;
  const progress = threshold > 0 ? Math.min(current / threshold, 1) : 0;

  log("Eligibility", {
    account,
    threshold,
    longest_winning_streak: current,
    eligible,
    progress,
  });

  return { eligible, progress };
}

// ---------- Exported achievements (one per tier) ----------
type StreakAchievement = Omit<IAchievement, "checkRequirement"> & {
  checkRequirement(
    account: string,
    ctx?: { longestWinningStreak?: number }
  ): Promise<{ eligible: boolean; progress: number }>;
};

const achievements = TIERS.map((t, i) => {
  const id = fullIdForKey(t.key);
  const tier = i + 1;
  const tiersTotal = TIERS.length;

  const ach: StreakAchievement = {
    id,
    name: `${SERIES_NAME} - ${t.label}`,
    description: `Achieve a winning streak of at least ${t.label} consecutive wins during pre-alpha.`,
    imageUrl: imageForKey(t.key),

    display: {
      category: AchievementCategory.WINS,
      series: SERIES_NAME,
      seriesKey: SERIES_KEY,
      tier,
      tiersTotal,
      order: tier,
      tags: ["pre-alpha", "original-degen", "streak", "consistency"],
    },

    contractAppIds: t.contractAppIds,
    getContractAppId() {
      const appId = getAppIdFor(this.id);
      log("getContractAppId()", { id: this.id, appId });
      return appId;
    },

    async checkRequirement(account: string, ctx?: { longestWinningStreak?: number }) {
      log("checkRequirement()", {
        id,
        account,
        tierLabel: t.label,
        threshold: t.streak,
      });
      return meetsLongestWinningStreak(account, t.streak, ctx);
    },

    async mint(account: string) {
      log("mint() start", { id, account });
      const appId = getAppIdFor(id);
      const has = await utils.hasAchievement(account, appId);

      if (!appId) {
        throw new Error(
          `No contractAppId configured for ${getNetwork()} (${id})`
        );
      }

      log("pre-mint state", { id, appId, alreadyHas: has });
      if (has) throw new Error("Already minted");

      const tx = await utils.mintSBT(appId, account);
      log("mint() done", { id, account, tx });
      return tx;
    },

    enabled: true,
    hidden: false,
  };

  return ach as unknown as IAchievement;
});

export default achievements;
