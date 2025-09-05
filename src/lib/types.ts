// src/lib/types.ts
export enum AchievementCategory {
  WAGERING = "wagering",
  WINS = "wins",
  LOSSES = "losses",
  LOYALTY = "loyalty",
  LP = "lp",
  COMMUNITY = "community",
  GAME = "game",
}

export type AchievementScope =
  | { kind: "global" }
  | { kind: "game"; gameKey: string; gameName?: string };

export interface AchievementDisplay {
  category: AchievementCategory;
  scope?: AchievementScope;
  series?: string;
  seriesKey?: string;
  tier?: number;
  tiersTotal?: number;
  order?: number;
  tags?: string[];
}

export interface IAchievement {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  contractAppIds: { mainnet: number; testnet: number; localnet: number };
  getContractAppId: () => number;

  checkRequirement: (account: string) => Promise<boolean>;
  mint: (account: string) => Promise<string>;

  enabled?: boolean;
  hidden?: boolean;

  display?: AchievementDisplay;
}
