// src/lib/achievements/prealpha-losing-streak.ts
import type { IAchievement } from "../types";
import { AchievementCategory } from "../types";
import * as utils from "../utils/voi";

// ---------- naming ----------
const SERIES_NAME = "Down Bad (Pre-Alpha)";
const SERIES_KEY  = "prealpha_losing_streak";

// ---------- logger ----------
const LP = "[ach:prealpha-losing-streak]";
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
  key: string;   // e.g., ls10
  label: string; // e.g., 10
  streak: number; // threshold consecutive losses
  contractAppIds: { mainnet: number; testnet: number; localnet: number };
}

// 5 tiers: 10 → 30 consecutive losses
const TIERS: readonly TierDef[] = [
  { key: "ls10", label: "10", streak: 10, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "ls15", label: "15", streak: 15, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "ls20", label: "20", streak: 20, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "ls25", label: "25", streak: 25, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "ls30", label: "30", streak: 30, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "ls50", label: "50", streak: 50, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "ls100", label: "100", streak: 100, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
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
type HovPlayerRow = { longest_losing_streak?: number };
type HovPlayerResponse = HovPlayerRow[];

/**
 * Exported so the route can precompute once per request and pass via ctx (optional).
 */
export async function getLongestLosingStreak(address: string): Promise<number> {
  const url = `${HOV_PLAYER_BASE}&address=${encodeURIComponent(address)}`;
  try {
    const rows = await fetchJson<HovPlayerResponse>(url);
    let ll = 0;
    if (Array.isArray(rows) && rows.length > 0) {
      if (typeof rows[0]?.longest_losing_streak === "number") {
        ll = rows[0].longest_losing_streak;
      } else {
        for (const r of rows) {
          const v = typeof r?.longest_losing_streak === "number" ? r.longest_losing_streak : 0;
          if (v > ll) ll = v;
        }
      }
    }
    log("longest_losing_streak", { address, longest_losing_streak: ll });
    return Number.isFinite(ll) && ll > 0 ? ll : 0;
  } catch {
    log("HOV fetch failed for longest_losing_streak (treating as 0)", { url });
    return 0;
  }
}

// ---------- Requirement logic ----------
async function meetsLongestLosingStreak(
  account: string,
  threshold: number,
  ctx?: { longestLosingStreak?: number }
): Promise<{ eligible: boolean; progress: number }> {
  const current =
    typeof ctx?.longestLosingStreak === "number"
      ? ctx.longestLosingStreak
      : await getLongestLosingStreak(account);

  // cache once per request to avoid duplicate fetches across tiers
  if (ctx && typeof ctx.longestLosingStreak !== "number") {
    ctx.longestLosingStreak = current;
  }

  const eligible = current >= threshold;
  const progress = threshold > 0 ? Math.min(current / threshold, 1) : 0;

  log("Eligibility", {
    account,
    threshold,
    longest_losing_streak: current,
    eligible,
    progress,
  });

  return { eligible, progress };
}

// ---------- Exported achievements (one per tier) ----------
type LosingStreakAchievement = Omit<IAchievement, "checkRequirement"> & {
  checkRequirement(
    account: string,
    ctx?: { longestLosingStreak?: number }
  ): Promise<{ eligible: boolean; progress: number }>;
};

const achievements = TIERS.map((t, i) => {
  const id = fullIdForKey(t.key);
  const tier = i + 1;
  const tiersTotal = TIERS.length;

  const ach: LosingStreakAchievement = {
    id,
    name: `${SERIES_NAME} - ${t.label}`,
    description: `Hit a losing streak of at least ${t.label} consecutive losses during pre-alpha.`,
    imageUrl: imageForKey(t.key),

    display: {
      category: AchievementCategory.LOSSES,
      series: SERIES_NAME,
      seriesKey: SERIES_KEY,
      tier,
      tiersTotal,
      order: tier,
      tags: ["pre-alpha", "original-degen", "streak", "endurance"],
    },

    contractAppIds: t.contractAppIds,
    getContractAppId() {
      const appId = getAppIdFor(this.id);
      log("getContractAppId()", { id: this.id, appId });
      return appId;
    },

    async checkRequirement(account: string, ctx?: { longestLosingStreak?: number }) {
      log("checkRequirement()", {
        id,
        account,
        tierLabel: t.label,
        threshold: t.streak,
      });
      return meetsLongestLosingStreak(account, t.streak, ctx);
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
