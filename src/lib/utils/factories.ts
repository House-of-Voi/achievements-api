// src/lib/achievements/factories.ts
import type { IAchievement } from '../types';
import { AchievementCategory } from '../types';
import * as utils from './voi';

type Tier = { suffix: string; name: string; desc: string; imageUrl?: string };

export function createGameTieredAchievements(opts: {
    gameKey: string;
    gameName?: string;
    baseId: string;               // e.g., 'xplosion-multiplier'
    series: string;               // e.g., 'Multiplier Master'
    seriesKey?: string;           // e.g., 'multiplier_master'
    tiers: Tier[];
    getAppId: (i: number) => number;
    requirement: (i: number, account: string) => Promise<boolean>;
}): IAchievement[] {
    const total = opts.tiers.length;
    return opts.tiers.map((t, i) => {
        const tier = i + 1;
        const id = `${opts.baseId}-${opts.gameKey}-${t.suffix}`; // stable & unique per game+tier

        const ach: IAchievement = {
            id,
            name: t.name,
            description: t.desc,
            imageUrl: t.imageUrl,
            contractAppIds: { mainnet: 0, testnet: opts.getAppId(i) },
            getContractAppId() {
                const network = process.env.NETWORK || 'testnet';
                if (network === 'mainnet' || network === 'testnet') {
                    type Net = 'mainnet' | 'testnet'
                    if (network === 'mainnet' || network === 'testnet') {
                        return this.contractAppIds[network as Net] ?? 0
                    }
                    return 0
                }
                return 0;
            },
            checkRequirement: (account) => opts.requirement(i, account),
            async mint(account) {
                const appId = this.getContractAppId();
                const assetId = await utils.getSBTAssetId(appId);
                if (await utils.hasAchievement(account, assetId)) throw new Error('Already minted');
                return utils.mintSBT(appId, account);
            },
            enabled: true,
            hidden: false,
            display: {
                category: AchievementCategory.GAME,
                scope: { kind: 'game', gameKey: opts.gameKey, gameName: opts.gameName },
                series: opts.series,
                seriesKey: opts.seriesKey,
                tier,
                tiersTotal: total,
                order: tier,
                tags: ['game'],
            },
        };
        return ach;
    });
}
