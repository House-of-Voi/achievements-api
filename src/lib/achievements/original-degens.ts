// src/lib/achievements/original-degens.ts
import type { IAchievement } from '../types'
import { AchievementCategory } from '../types'
import * as utils from '../utils/voi'

// ---------- logger ----------
const LP = '[ach:original-degens]'
const nowIso = () => new Date().toISOString()
const log = (msg: string, data?: Record<string, unknown>) =>
  (data ? console.log(`${LP} ${nowIso()} ${msg}`, data) : console.log(`${LP} ${nowIso()} ${msg}`))

// ---------- External data sources ----------
// NOTE: per your request, appId is hardcoded in the base URL (same behavior as Wager Warrior).
const HOV_PLAYER_BASE = 'https://voi-mainnet-mimirapi.nftnavigator.xyz/hov/players?appId=40879920'
const VOI_PRICE_URL   = 'https://voirewards.com/api/markets?token=VOI'
const VOI_DECIMALS = 6

// ---------- Network / contract helpers ----------
type Net = 'mainnet' | 'testnet'
type Network = Net | 'local'
const getNetwork = (): Network => {
  const n = process.env.NETWORK
  const net: Network = n === 'mainnet' || n === 'testnet' || n === 'local' ? n : 'testnet'
  log('Resolved NETWORK', { net })
  return net
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

interface TierDef {
  key: string
  label: string
  usd: number
  contractAppIds: { mainnet: number; testnet: number }
}

// Lower milestone curve for early testers
const TIERS: readonly TierDef[] = [
  { key: '100',   label: '100',   usd: 100,    contractAppIds: { mainnet: 0, testnet: 0 } },
  { key: '250',   label: '250',   usd: 250,    contractAppIds: { mainnet: 0, testnet: 0 } },
  { key: '500',   label: '500',   usd: 500,    contractAppIds: { mainnet: 0, testnet: 0 } },
  { key: '1k',    label: '1K',    usd: 1_000,  contractAppIds: { mainnet: 0, testnet: 0 } },
  { key: '2_5k',  label: '2.5K',  usd: 2_500,  contractAppIds: { mainnet: 0, testnet: 0 } },
  { key: '5k',    label: '5K',    usd: 5_000,  contractAppIds: { mainnet: 0, testnet: 0 } },
  { key: '10k',   label: '10K',   usd: 10_000, contractAppIds: { mainnet: 0, testnet: 0 } },
  { key: '50k',   label: '50K',   usd: 50_000, contractAppIds: { mainnet: 0, testnet: 0 } },
] as const

const fullIdForKey = (key: string) => `original-degens-${key}`
const imageForKey  = (key: string) => `/achievements/${fullIdForKey(key)}.png`

const findTierById = (id: string): TierDef | undefined => {
  const key = id.replace(/^original-degens-/, '')
  return TIERS.find((t) => t.key === key)
}

function getAppIdFor(id: string): number {
  const net = getNetwork()
  if (net === 'local') {
    const localIds = getLocalAppIds()
    const appId = localIds[id] || 0
    log('getAppIdFor(local)', { id, appId })
    return appId
  }
  const tier = findTierById(id)
  const appId = tier ? tier.contractAppIds[net] ?? 0 : 0
  log('getAppIdFor', { id, net, appId })
  return appId
}

// ---------- Fetch helpers ----------
async function fetchJson<T>(url: string, timeoutMs = 6000): Promise<T> {
  log('HTTP GET', { url })
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    log('HTTP status', { url, status: res.status })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as T
    return data
  } finally {
    clearTimeout(t)
  }
}

// HOV API types
type HovPlayerRow = { total_amount_bet: number }
type HovPlayerResponse = HovPlayerRow[]

// VOI price types
type VoiMarketsResponse = {
  aggregates?: { weightedAveragePrice?: number }
  marketData?: Array<{ network?: string; price?: number }>
}

let _priceCache: { t: number; usd: number } | null = null
const PRICE_TTL_MS = 60_000

async function getVoiUsdPrice(): Promise<number> {
  const now = Date.now()
  if (_priceCache && now - _priceCache.t < PRICE_TTL_MS) {
    log('VOI price (cache hit)', { price: _priceCache.usd })
    return _priceCache.usd
  }
  try {
    const data = await fetchJson<VoiMarketsResponse>(VOI_PRICE_URL)
    let price = data.aggregates?.weightedAveragePrice
    if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
      const voiRows = (data.marketData ?? []).filter(
        (m) => m.network?.toLowerCase() === 'voi' && typeof m.price === 'number'
      )
      const sum = voiRows.reduce((acc, m) => acc + (m.price || 0), 0)
      price = voiRows.length ? sum / voiRows.length : undefined
    }
    if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
      price = 1e-9
    }
    _priceCache = { t: now, usd: price }
    log('VOI price (fresh)', { price })
    return price
  } catch {
    log('VOI price fetch failed; using tiny fallback')
    return 1e-9
  }
}

async function getTotalWagerUsd(address: string): Promise<number> {
  const url = `${HOV_PLAYER_BASE}&address=${encodeURIComponent(address)}`
  const priceUsd = await getVoiUsdPrice()
  let totalBaseUnits = 0

  try {
    const rows = await fetchJson<HovPlayerResponse>(url)
    totalBaseUnits = Array.isArray(rows)
      ? rows.reduce((acc, r) => acc + (typeof r?.total_amount_bet === 'number' ? r.total_amount_bet : 0), 0)
      : 0
    log('HOV rows (hardcoded app)', {
      rows: Array.isArray(rows) ? rows.length : 0,
      total_base_units: totalBaseUnits
    })
  } catch {
    log('HOV fetch failed (treating as 0)', { url })
  }

  const voi = totalBaseUnits / 10 ** VOI_DECIMALS
  const totalUsd = voi * priceUsd
  log('Wager totals', { baseUnits: totalBaseUnits, voi, priceUsd, totalUsd })
  return totalUsd
}

// ---------- Requirement logic ----------
async function meetsTotalWagerUSD(account: string, thresholdUsd: number): Promise<boolean> {
  const totalUsd = await getTotalWagerUsd(account)
  const eligible = totalUsd >= thresholdUsd
  log('Eligibility', { account, thresholdUsd, totalUsd, eligible })
  return eligible
}

// ---------- Exported achievements (one per tier) ----------
const achievements: IAchievement[] = TIERS.map((t, i) => {
  const id = fullIdForKey(t.key)
  const tier = i + 1
  const tiersTotal = TIERS.length

  const ach: IAchievement = {
    id,
    name: `Original Degens - ${t.label}`,
    description: `As an early tester, reach a total wagered amount of ${t.label} USD equivalent.`,
    // Use static file under /public/achievements/<id>.webp
    imageUrl: imageForKey(t.key),

    display: {
      category: AchievementCategory.WAGERING,
      series: 'Original Degens',
      seriesKey: 'original_degens',
      tier,
      tiersTotal,
      order: tier,
      tags: ['early', 'milestone', 'volume'],
      // scope omitted => global
    },

    contractAppIds: t.contractAppIds,
    getContractAppId() {
      const appId = getAppIdFor(this.id)
      log('getContractAppId()', { id: this.id, appId })
      return appId
    },

    async checkRequirement(account) {
      log('checkRequirement()', { id, account, tierLabel: t.label, thresholdUsd: t.usd })
      return meetsTotalWagerUSD(account, t.usd)
    },

    async mint(account) {
      log('mint() start', { id, account })
      const appId = getAppIdFor(id)
      const assetId = await utils.getSBTAssetId(appId)
      const has = await utils.hasAchievement(account, assetId)
      log('pre-mint state', { id, appId, assetId, alreadyHas: has })
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
