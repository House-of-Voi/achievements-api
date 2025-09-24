// src/lib/achievements/tournament-2025-09-13_win_streak.ts
import type { IAchievement } from "../types";
import { AchievementCategory } from "../types";
import * as utils from "../utils/voi";

/**
 * Configure this section per tournament AND per category.
 * You will create one file per category for each tournament.
 */

// Required unique identifier so we can run many tournaments in parallel or historically
const TOURNAMENT_ID = "2025-09-13_weekend_v1";

// Human label for this tournament window
const TOURNAMENT_LABEL = "Weekend Tournament 2025-09-13";

// Category to award podiums for in this file
// Valid keys based on your payload:
//   "overall" | "volume" | "rtp" | "win_streak" | "biggest_win" | "total_won" | "losing_streak"
const CATEGORY_NAME = "Win Streak";
const CATEGORY_KEY = "win_streak";

// Series labels include the tournament id to keep assets and ids unique
const SERIES_NAME = `${TOURNAMENT_LABEL} – ${CATEGORY_NAME}`;
const SERIES_KEY = `tournament_${TOURNAMENT_ID}_${CATEGORY_KEY}`;

// Use this exact static tournament URL
const TOURNAMENT_URL =
  "https://voi-mainnet-mimirapi.nftnavigator.xyz/hov/tournament/weekend-2025-09-12";

// ---------- logger ----------
const LP = `[ach:tournament:${TOURNAMENT_ID}:${CATEGORY_KEY}]`;
const nowIso = () => new Date().toISOString();
const log = (msg: string, data?: Record<string, unknown>) =>
  data ? console.log(`${LP} ${nowIso()} ${msg}`, data) : console.log(`${LP} ${nowIso()} ${msg}`);

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

interface PodiumDef {
  key: string; // p1, p2, p3
  label: string; // 1st, 2nd, 3rd
  placement: 1 | 2 | 3;
  contractAppIds: { mainnet: number; testnet: number; localnet: number };
}

const PODIUM: readonly PodiumDef[] = [
  { key: "p1", label: "1st", placement: 1, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "p2", label: "2nd", placement: 2, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "p3", label: "3rd", placement: 3, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
] as const;

const fullIdForKey = (key: string) => `${SERIES_KEY}-${key}`;
const imageForKey = (key: string) => `/achievements/${fullIdForKey(key)}.png`;

const findById = (id: string): PodiumDef | undefined => {
  const key = id.replace(new RegExp(`^${SERIES_KEY}-`), "");
  return PODIUM.find((p) => p.key === key);
};

function getAppIdFor(id: string): number {
  const net = getNetwork();
  if (net === "localnet") {
    const localIds = getLocalAppIds();
    const appId = localIds[id] || 0;
    log("getAppIdFor(localnet)", { id, appId });
    return appId;
  }
  const podium = findById(id);
  const chainNet: "mainnet" | "testnet" = net;
  const appId = podium ? podium.contractAppIds[chainNet] ?? 0 : 0;
  log("getAppIdFor", { id, net: chainNet, appId });
  return appId;
}

// ---------- fetch helpers ----------
async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
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

type LeaderRow = {
  who?: string;
  rank?: number; // overall combined rank (unused here)
  streak_rank?: number; // we will use this for win_streak podium
};
type TournamentResponse = {
  params?: Record<string, unknown>;
  categories?: Record<string, LeaderRow[]>;
} | null | undefined;

/**
 * Returns the user's placement for WIN_STREAK using the `overall[].streak_rank` field.
 * (We intentionally read from the "overall" category's `streak_rank`, NOT the "win_streak" table.)
 */
export async function getRankFromLeaderboard(address: string): Promise<number> {
  const url = TOURNAMENT_URL;
  try {
    const body = await fetchJson<TournamentResponse>(url);

    // Read from "overall" and take the `streak_rank` for the given address.
    const overall = body?.categories?.overall;
    if (!Array.isArray(overall) || overall.length === 0) {
      log("No rows for category 'overall' (cannot resolve streak_rank)");
      return 0;
    }

    const row = overall.find((r) => typeof r?.who === "string" && r.who === address);
    const rank = row?.streak_rank ?? 0;
    const valid = typeof rank === "number" && rank > 0 ? Math.floor(rank) : 0;
    log("resolved streak podium from overall.streak_rank", { address, rank: valid });
    return valid;
  } catch {
    log("Tournament fetch failed (treating as 0)", { url: TOURNAMENT_URL });
    return 0;
  }
}

// ---------- requirement logic ----------
async function meetsPodiumPlacement(
  account: string,
  targetPlacement: 1 | 2 | 3,
  ctx?: Record<string, unknown>
): Promise<{ eligible: boolean; progress: number }> {
  const CTX_KEY = `lbRank:${SERIES_KEY}`.replace(/\s/g, ""); // ensure no spaces
  const store = ctx as Record<string, number> | undefined;

  const cached = store && typeof store[CTX_KEY] === "number" ? store[CTX_KEY] : undefined;
  const current = typeof cached === "number" ? cached : await getRankFromLeaderboard(account);

  if (store && typeof cached !== "number") {
    store[CTX_KEY] = current;
  }

  const eligible = current === targetPlacement;
  const progress = eligible ? 1 : 0;
  return { eligible, progress };
}

// ---------- exported achievements (1st/2nd/3rd) ----------
type TournamentAchievement = Omit<IAchievement, "checkRequirement"> & {
  checkRequirement(
    account: string,
    ctx?: Record<string, unknown>
  ): Promise<{ eligible: boolean; progress: number }>;
};

const achievements = PODIUM.map((p, i) => {
  const id = fullIdForKey(p.key);
  const tier = i + 1;
  const tiersTotal = PODIUM.length;

  const ach: TournamentAchievement = {
    id,
    name: `${SERIES_NAME} – ${p.label}`,
    description: `Finish ${p.label.toLowerCase()} in ${CATEGORY_NAME} for ${TOURNAMENT_LABEL}.`,
    imageUrl: imageForKey(p.key),

    display: {
      category: AchievementCategory.TOURNAMENT,
      series: SERIES_NAME,
      seriesKey: SERIES_KEY,
      tier,
      tiersTotal,
      order: tier,
      tags: ["tournament", TOURNAMENT_ID, CATEGORY_KEY, p.label.toLowerCase()],
    },

    contractAppIds: p.contractAppIds,
    getContractAppId() {
      const appId = getAppIdFor(this.id);
      log("getContractAppId()", { id: this.id, appId });
      return appId;
    },

    async checkRequirement(account: string, ctx?: Record<string, unknown>) {
      log("checkRequirement()", {
        id,
        tournamentId: TOURNAMENT_ID,
        categoryKey: CATEGORY_KEY,
        account,
        target: p.placement,
      });
      return meetsPodiumPlacement(account, p.placement, ctx);
    },

    async mint(account: string) {
      log("mint() start", { id, tournamentId: TOURNAMENT_ID, account });
      const appId = getAppIdFor(id);
      const has = await utils.hasAchievement(account, appId);

      if (!appId) {
        throw new Error(`No contractAppId configured for ${getNetwork()} (${id})`);
      }

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
