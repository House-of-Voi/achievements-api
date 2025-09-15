// src/lib/types.ts

/** Category constants (value) + exact string-union type (type) */
export const AchievementCategory = {
  WAGERING:  "wagering",
  WINS:      "wins",
  LOSSES:    "losses",
  LOYALTY:   "loyalty",
  LP:        "lp",
  COMMUNITY: "community",
  GAME:      "game",
  TOURNAMENT:"tournament",
} as const;

// This type is *exactly* the union of the values above: "wagering" | ... | "tournament"
export type AchievementCategory =
  (typeof AchievementCategory)[keyof typeof AchievementCategory];

/** Network + Contract IDs */
export type Network = "mainnet" | "testnet" | "localnet";
export type ContractAppIds = { mainnet: number; testnet: number; localnet: number };

/** Optional scoping of an achievement */
export type AchievementScope =
  | { kind: "global" }
  | { kind: "game"; gameKey: string; gameName?: string };

/** Display info carried by each achievement */
export interface AchievementDisplay {
  category: AchievementCategory; // <- exact union compatible with OpenAPI
  scope?: AchievementScope;
  series?: string;
  seriesKey?: string;
  tier?: number;       // 1..N within a series
  tiersTotal?: number; // N
  order?: number;      // sorting hint inside a series
  tags?: string[];
}

/** Requirement check result */
export type RequirementResult =
  | boolean
  | { eligible: boolean; progress?: number };

/** Core Achievement interface */
export interface IAchievement {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;

  contractAppIds: ContractAppIds;
  getContractAppId: () => number;

  checkRequirement: (account: string, ctx?: Record<string, unknown>) => Promise<RequirementResult>;
  mint: (account: string) => Promise<string>;

  enabled?: boolean;
  hidden?: boolean;

  display?: AchievementDisplay;
}

/** Optional tags */
export type AchievementTag =
  | "milestone"
  | "volume"
  | "streak"
  | "endurance"
  | "original-degen"
  | "pre-alpha"
  | "podium"
  | "tournament"
  | string;

/** Voi address guard */
export function isVoiAddress(addr: unknown): addr is string {
  return typeof addr === "string" && /^[A-Z2-7]{58}$/.test(addr);
}
