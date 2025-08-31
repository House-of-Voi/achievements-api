// src/lib/achievements/multiplier-master.ts
import type { IAchievement } from '../types'
import { AchievementCategory } from '../types'
import * as utils from '../utils/voi'

// Different number of tiers + global multiplier thresholds
const TIERS = [
  { key: 'x25',   label: '25x',   minX: 25 },
  { key: 'x50',   label: '50x',   minX: 50 },
  { key: 'x100',  label: '100x',  minX: 100 },
  { key: 'x500',  label: '500x',  minX: 500 },
  { key: 'x1000', label: '1000x', minX: 1000 },
] as const

// Optional: per-tier ARC-72 app ids (fill in when deployed)
const CONTRACT_APP_IDS: Record<string, { mainnet: number; testnet: number }> = {
  // 'multiplier-master-x25':   { mainnet: 0, testnet: 0 },
  // 'multiplier-master-x50':   { mainnet: 0, testnet: 0 },
  // ...
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

// TODO: replace with your real telemetry/oracle check (casino-wide)
async function hitMultiplierAtLeast(_account: string, _minX: number): Promise<boolean> {
  void _account; void _minX
  return false
}

const achievements: IAchievement[] = TIERS.map((t, i) => {
  const id = `multiplier-master-${t.key}`
  const tier = i + 1
  const tiersTotal = TIERS.length

  const ach: IAchievement = {
    id,
    name: `Multiplier Master — ${t.label}`,
    description: `Hit a single-bet multiplier of at least ${t.label} anywhere in the casino.`,
    imageUrl: `https://example.com/multiplier-master-${t.key}.png`,

    // Global (casino-wide) display metadata: no game scope
    display: {
      category: AchievementCategory.WINS,
      series: 'Multiplier Master',
      seriesKey: 'multiplier_master',
      tier,
      tiersTotal,
      order: tier,
      tags: ['multiplier', 'casino-wide'],
    },

    contractAppIds: {
      mainnet: CONTRACT_APP_IDS[id]?.mainnet ?? 0,
      testnet: CONTRACT_APP_IDS[id]?.testnet ?? 0,
    },
    getContractAppId() { return getAppIdFor(this.id) },

    // Global requirement: any game qualifies if minX is met
    checkRequirement: (account) => hitMultiplierAtLeast(account, t.minX),

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
