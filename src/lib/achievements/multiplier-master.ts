// src/lib/achievements/multiplier-master.ts
import type { IAchievement } from '../types'
import { AchievementCategory } from '../types'
import * as utils from '../utils/voi'

// ---------- logger ----------
const LP = '[ach:multiplier-master]'
const nowIso = () => new Date().toISOString()
const log = (msg: string, data?: Record<string, unknown>) =>
  (data ? console.log(`${LP} ${nowIso()} ${msg}`, data) : console.log(`${LP} ${nowIso()} ${msg}`))

// ---------- Static image helper (served from /public) ----------
const IMG_BASE = '/achievements/multiplier-master'
const imageFor = (key: string) => `${IMG_BASE}/multiplier-master-${key}.png`

// ---------- Network / contract helpers ----------
type Net = 'mainnet' | 'testnet'
type Network = Net | 'localnet'

const getNetwork = (): Network => {
  const raw = (process.env.NETWORK || '').toLowerCase()
  if (raw === 'mainnet' || raw === 'testnet') {
    log('Resolved NETWORK', { net: raw })
    return raw
  }
  // Treat "local" / "devnet" as aliases for "localnet"
  log('Resolved NETWORK', { net: 'localnet', from: raw || '(unset)' })
  return 'localnet'
}

function getLocalAppIds(): Record<string, number> {
  const raw = process.env.LOCAL_APP_IDS
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw) as Record<string, number>
    log('Loaded LOCAL_APP_IDS', { keys: Object.keys(obj).length })
    return obj
  } catch {
    log('Failed to parse LOCAL_APP_IDS JSON')
    return {}
  }
}

// ---------- Tiers ----------
interface TierDef {
  key: string
  label: string
  minX: number
  contractAppIds: { mainnet: number; testnet: number; localnet: number }
}

const TIERS: readonly TierDef[] = [
  { key: 'x25', label: '25x', minX: 25, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: 'x50', label: '50x', minX: 50, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: 'x100', label: '100x', minX: 100, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: 'x500', label: '500x', minX: 500, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
  { key: 'x1000', label: '1000x', minX: 1000, contractAppIds: { mainnet: 0, testnet: 0, localnet: 0 } },
] as const

const fullIdForKey = (key: string) => `multiplier-master-${key}`
const findTierById = (id: string): TierDef | undefined => {
  const key = id.replace(/^multiplier-master-/, '')
  return TIERS.find((t) => t.key === key)
}

function getAppIdFor(id: string): number {
  const net = getNetwork()
  if (net === 'localnet') {
    const localIds = getLocalAppIds()
    const appId = localIds[id] || 0
    log('getAppIdFor(localnet)', { id, appId })
    return appId
  }
  const tier = findTierById(id)
  const chainNet: 'mainnet' | 'testnet' = net // narrow type
  const appId = tier ? tier.contractAppIds[chainNet] ?? 0 : 0
  log('getAppIdFor', { id, net: chainNet, appId })
  return appId
}

// ---------- Eligibility stub (replace with real casino-wide telemetry) ----------
async function hitMultiplierAtLeast(account: string, minX: number): Promise<boolean> {
  log('hitMultiplierAtLeast() stub', { account, minX })
  // TODO: plug in your real check (e.g., telemetry/oracle lookup)
  return false
}

// ---------- Exported achievements ----------
const achievements: IAchievement[] = TIERS.map((t, i) => {
  const id = fullIdForKey(t.key)
  const tier = i + 1
  const tiersTotal = TIERS.length

  const ach: IAchievement = {
    id,
    name: `Multiplier Master — ${t.label}`,
    description: `Hit a single-bet multiplier of at least ${t.label} anywhere in the casino.`,
    imageUrl: imageFor(t.key),

    display: {
      category: AchievementCategory.WINS,
      series: 'Multiplier Master',
      seriesKey: 'multiplier_master',
      tier,
      tiersTotal,
      order: tier,
      tags: ['multiplier', 'casino-wide'],
    },

    contractAppIds: t.contractAppIds,
    getContractAppId() {
      const appId = getAppIdFor(this.id)
      log('getContractAppId()', { id: this.id, appId })
      return appId
    },

    async checkRequirement(account) {
      log('checkRequirement()', { id, account, minX: t.minX })
      return hitMultiplierAtLeast(account, t.minX)
    },

    async mint(account) {
      log('mint() start', { id, account })
      const appId = getAppIdFor(id)
      const has = await utils.hasAchievement(account, appId)

      log('pre-mint state', { id, appId, alreadyHas: has })
      if (has) throw new Error('Already minted')

      const tx = await utils.mintSBT(appId, account)
      log('mint() done', { id, account, tx })
      return tx
    },

    enabled: true,
    hidden: false,
  }

  return ach
})

export default achievements
