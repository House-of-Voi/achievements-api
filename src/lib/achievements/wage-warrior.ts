// src/lib/achievements/wager-warrior.ts
import type { IAchievement } from '../types'
import { AchievementCategory } from '../types'
import * as utils from '../utils/voi'

// Configure tiers and thresholds (flexible length)
const TIERS = [
  { key: '100k', label: '100K', usd: 100_000 },
  { key: '200k', label: '200K', usd: 200_000 },
  { key: '500k', label: '500K', usd: 500_000 },
  { key: '1m',   label: '1M',   usd: 1_000_000 },
  { key: '5m',   label: '5M',   usd: 5_000_000 },
  { key: '10m',  label: '10M',  usd: 10_000_000 },
] as const

// Optional: map each tier to its own ARC-72 app id (set later)
const CONTRACT_APP_IDS: Record<string, { mainnet: number; testnet: number }> = {
  // 'wager-warrior-100k': { mainnet: 0, testnet: 0 },
}

function getAppIdFor(id: string): number {
  const network = process.env.NETWORK || 'testnet'
  if (network === 'local') {
    const localIds = process.env.LOCAL_APP_IDS ? JSON.parse(process.env.LOCAL_APP_IDS) : {}
    return (localIds as Record<string, number>)[id] || 0
  }
  if (network === 'mainnet' || network === 'testnet') {
    return CONTRACT_APP_IDS[id]?.[network] ?? 0
  }
  return 0
}

// TODO: replace with your real telemetry check
async function meetsTotalWagerUSD(_account: string, _thresholdUsd: number): Promise<boolean> {
  void _account; void _thresholdUsd
  return false
}

const achievements: IAchievement[] = TIERS.map((t, i) => {
  const id = `wager-warrior-${t.key}`
  const tier = i + 1
  const tiersTotal = TIERS.length

  const ach: IAchievement = {
    id,
    name: `Wager Warrior - ${t.label}`,
    description: `Reach a total wagered amount of ${t.label} USD equivalent.`,
    imageUrl: `https://example.com/wager-warrior-${t.key}.png`,

    display: {
      category: AchievementCategory.WAGERING,
      series: 'Wager Warrior',
      seriesKey: 'wager_warrior',
      tier,
      tiersTotal,
      order: tier,
      tags: ['milestone', 'volume'],
      // scope omitted => global
    },

    contractAppIds: {
      mainnet: CONTRACT_APP_IDS[id]?.mainnet ?? 0,
      testnet: CONTRACT_APP_IDS[id]?.testnet ?? 0,
    },
    getContractAppId() { return getAppIdFor(this.id) },

    checkRequirement: (account) => meetsTotalWagerUSD(account, t.usd),

    mint: async (account) => {
      const appId = getAppIdFor(id)
      const assetId = await utils.getSBTAssetId(appId)
      if (await utils.hasAchievement(account, assetId)) throw new Error('Already minted')
      return utils.mintSBT(appId, account)
    },

    enabled: true,
    hidden: false,
  }

  return ach
})

export default achievements
