// src/lib/achievements/prealpha-multipliers.ts
import type { IAchievement } from "../types";
import { AchievementCategory } from "../types";
import * as utils from "../utils/voi";

// ---------- naming ----------
const SERIES_NAME = "Multiplier Mayhem (Pre-Alpha)";
const SERIES_KEY = "prealpha_multipliers";

// ---------- logger ----------
const LP = "[ach:prealpha-multipliers]";
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
    key: string;   // e.g., x10
    label: string; // e.g., 10x
    x: number;     // threshold multiple
    contractAppIds: { mainnet: number; testnet: number; localnet: number };
}

// 10 tiers: 10x → 1000x
const TIERS: readonly TierDef[] = [
    { key: "x10", label: "10x", x: 10, contractAppIds: { mainnet: 42397807, testnet: 0, localnet: 0 } },
    { key: "x25", label: "25x", x: 25, contractAppIds: { mainnet: 42398534, testnet: 0, localnet: 0 } },
    { key: "x50", label: "50x", x: 50, contractAppIds: { mainnet: 42399275, testnet: 0, localnet: 0 } },
    { key: "x75", label: "75x", x: 75, contractAppIds: { mainnet: 42400140, testnet: 0, localnet: 0 } },
    { key: "x100", label: "100x", x: 100, contractAppIds: { mainnet: 42400983, testnet: 0, localnet: 0 } },
    { key: "x150", label: "150x", x: 150, contractAppIds: { mainnet: 42402148, testnet: 0, localnet: 0 } },
    { key: "x250", label: "250x", x: 250, contractAppIds: { mainnet: 42402411, testnet: 0, localnet: 0 } },
    { key: "x500", label: "500x", x: 500, contractAppIds: { mainnet: 42402693, testnet: 0, localnet: 0 } },
    { key: "x750", label: "750x", x: 750, contractAppIds: { mainnet: 42402938, testnet: 0, localnet: 0 } },
    { key: "x1000", label: "1000x", x: 1000, contractAppIds: { mainnet: 42403201, testnet: 0, localnet: 0 } },
    { key: "x10000", label: "10000x", x: 10000, contractAppIds: { mainnet: 42403392, testnet: 0, localnet: 0 } },
] as const;

const fullIdForKey = (key: string) => `${SERIES_KEY}-${key}`;
const imageForKey = (key: string) => `/achievements/${fullIdForKey(key)}.png`;

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
type HovPlayerRow = { highest_multiple?: number };
type HovPlayerResponse = HovPlayerRow[];

/**
 * Exported so the route can precompute once per request and pass via ctx (optional).
 */
export async function getHighestMultiple(address: string): Promise<number> {
    const url = `${HOV_PLAYER_BASE}&address=${encodeURIComponent(address)}`;
    try {
        const rows = await fetchJson<HovPlayerResponse>(url);
        let hm = 0;
        if (Array.isArray(rows) && rows.length > 0) {
            if (typeof rows[0]?.highest_multiple === "number") {
                hm = rows[0].highest_multiple;
            } else {
                for (const r of rows) {
                    const v = typeof r?.highest_multiple === "number" ? r.highest_multiple : 0;
                    if (v > hm) hm = v;
                }
            }
        }
        log("highest_multiple", { address, highest_multiple: hm });
        return Number.isFinite(hm) && hm > 0 ? hm : 0;
    } catch {
        log("HOV fetch failed for highest_multiple (treating as 0)", { url });
        return 0;
    }
}

// ---------- Requirement logic ----------
async function meetsHighestMultiple(
    account: string,
    thresholdX: number,
    ctx?: { highestMultiple?: number }
): Promise<{ eligible: boolean; progress: number }> {
    const current =
        typeof ctx?.highestMultiple === "number"
            ? ctx.highestMultiple
            : await getHighestMultiple(account);

    if (ctx && typeof ctx.highestMultiple !== "number") {
        ctx.highestMultiple = current; // cache for subsequent tiers this request
    }

    const eligible = current >= thresholdX;
    const progress = thresholdX > 0 ? Math.min(current / thresholdX, 1) : 0;

    log("Eligibility", {
        account,
        thresholdX,
        highest_multiple: current,
        eligible,
        progress,
    });

    return { eligible, progress };
}

// ---------- Exported achievements (one per tier) ----------
type MultiplierAchievement = Omit<IAchievement, "checkRequirement"> & {
    checkRequirement(
        account: string,
        ctx?: { highestMultiple?: number }
    ): Promise<{ eligible: boolean; progress: number }>;
};

const achievements = TIERS.map((t, i) => {
    const id = fullIdForKey(t.key);
    const tier = i + 1;
    const tiersTotal = TIERS.length;

    const ach: MultiplierAchievement = {
        id,
        name: `${SERIES_NAME} - ${t.label}`,
        description: `Hit a single win of at least ${t.label} your bet during pre-alpha.`,
        imageUrl: imageForKey(t.key),

        display: {
            category: AchievementCategory.WINS,
            series: SERIES_NAME,
            seriesKey: SERIES_KEY,
            tier,
            tiersTotal,
            order: tier,
            tags: ["pre-alpha", "original-degen", "multiplier", "peak"],
        },

        contractAppIds: t.contractAppIds,
        getContractAppId() {
            const appId = getAppIdFor(this.id);
            log("getContractAppId()", { id: this.id, appId });
            return appId;
        },

        async checkRequirement(account: string, ctx?: { highestMultiple?: number }) {
            log("checkRequirement()", {
                id,
                account,
                tierLabel: t.label,
                thresholdX: t.x,
            });
            return meetsHighestMultiple(account, t.x, ctx);
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
