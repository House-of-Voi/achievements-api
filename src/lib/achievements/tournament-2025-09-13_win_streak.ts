// src/lib/achievements/tournament-2025-09-13_overall.ts
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
const CATEGORY_KEY  = "win_streak";

// Hard coded time window and filters for this tournament
const APP_ID        = 40879920;
const START_TS      = "2025-09-13T00:00:00Z";
const END_TS        = "2025-09-15T03:59:59Z";
const LIMIT         = 100;
const MIN_SPINS     = 500;
const MIN_VOL_MICRO = 25_000_000_000;

// Series labels include the tournament id to keep assets and ids unique
const SERIES_NAME = `${TOURNAMENT_LABEL} – ${CATEGORY_NAME}`;
const SERIES_KEY  = `tournament_${TOURNAMENT_ID}_${CATEGORY_KEY}`;

// Leaderboard base (the only thing not hard coded into the window itself)
const LEADERBOARD_BASE = "https://voi-mainnet-mimirapi.nftnavigator.xyz/hov/leaderboard";

// ---------- logger ----------
const LP = `[ach:tournament:${TOURNAMENT_ID}:${CATEGORY_KEY}]`;
const nowIso = () => new Date().toISOString();
const log = (msg: string, data?: Record<string, unknown>) =>
  data ? console.log(`${LP} ${nowIso()} ${msg}`, data)
       : console.log(`${LP} ${nowIso()} ${msg}`);

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
  key: string;         // p1, p2, p3
  label: string;       // 1st, 2nd, 3rd
  placement: 1 | 2 | 3;
  contractAppIds: { mainnet: number; testnet: number; localnet: number };
}

const PODIUM: readonly PodiumDef[] = [
  { key: "p1", label: "1st", placement: 1, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "p2", label: "2nd", placement: 2, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: "p3", label: "3rd", placement: 3, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
] as const;

const fullIdForKey = (key: string) => `${SERIES_KEY}-${key}`;
const imageForKey  = (key: string) => `/achievements/${fullIdForKey(key)}.png`;

const findById = (id: string): PodiumDef | undefined => {
  const key = id.replace(new RegExp(`^${SERIES_KEY}-`), "");
  return PODIUM.find(p => p.key === key);
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

type LeaderRow = { who?: string; rank?: number };
type LeaderboardResponse = {
  params?: Record<string, unknown>;
  categories?: Record<string, LeaderRow[]>;
} | null | undefined;

function buildLeaderboardUrl(): string {
  const qs = new URLSearchParams();
  qs.set("appId", String(APP_ID));
  qs.set("startTs", START_TS);
  qs.set("endTs", END_TS);
  qs.set("limit", String(LIMIT));
  qs.set("min_spins", String(MIN_SPINS));
  qs.set("min_volume_micro", String(MIN_VOL_MICRO));
  return `${LEADERBOARD_BASE}?${qs.toString()}`;
}

/**
 * Returns the user's numeric rank within CATEGORY_KEY for this specific tournament window, or 0.
 */
export async function getRankFromLeaderboard(address: string): Promise<number> {
  const url = buildLeaderboardUrl();
  try {
    const body = await fetchJson<LeaderboardResponse>(url);
    const table = body?.categories?.[CATEGORY_KEY];
    if (!Array.isArray(table) || table.length === 0) {
      log("No rows for category", { categoryKey: CATEGORY_KEY });
      return 0;
    }
    const row = table.find(r => typeof r?.who === "string" && r.who === address);
    const rank = row?.rank ?? 0;
    const valid = typeof rank === "number" && rank > 0 ? Math.floor(rank) : 0;
    log("resolved rank", { categoryKey: CATEGORY_KEY, address, rank: valid });
    return valid;
  } catch {
    log("Leaderboard fetch failed (treating as 0)", { url: buildLeaderboardUrl() });
    return 0;
  }
}

// ---------- requirement logic ----------
async function meetsPodiumPlacement(
  account: string,
  targetPlacement: 1 | 2 | 3,
  ctx?: Record<string, unknown>     // <= was { leaderboardRank?: number }
): Promise<{ eligible: boolean; progress: number }> {
  const CTX_KEY = `lbRank:${SERIES_KEY}`; // namespaced cache key

  const cached =
    typeof ctx?.[CTX_KEY as keyof typeof ctx] === "number"
      ? (ctx![CTX_KEY as keyof typeof ctx] as number)
      : undefined;

  const current = typeof cached === "number"
    ? cached
    : await getRankFromLeaderboard(account);

  if (ctx && typeof cached !== "number") {
    (ctx as any)[CTX_KEY] = current; // store per series/category
  }

  const eligible = current === targetPlacement;
  const progress = eligible ? 1 : 0;
  return { eligible, progress };
}
// ---------- exported achievements (1st/2nd/3rd) ----------
type TournamentAchievement = Omit<IAchievement, "checkRequirement"> & {
  checkRequirement(
    account: string,
    ctx?: Record<string, unknown>     // <= was { leaderboardRank?: number }
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

    async checkRequirement(account: string, ctx?: { leaderboardRank?: number }) {
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
