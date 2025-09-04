/**
 * VOI helpers for achievements API
 * - Keep hasAchievement intact
 * - Stub mintSBT with logs only (no network or signing)
 */

// ---------- tiny logger ----------
const LP = '[voi]'
const nowIso = () => new Date().toISOString()
const log = (msg: string, data?: Record<string, unknown>) =>
  (data ? console.log(`${LP} ${nowIso()} ${msg}`, data) : console.log(`${LP} ${nowIso()} ${msg}`))

// ---------- network/env helpers ----------
type Net = 'mainnet' | 'testnet' | 'local'
const getNet = (): Net => {
  const n = (process.env.NETWORK || 'mainnet').toLowerCase()
  if (n === 'testnet') return 'testnet'
  if (n === 'local' || n === 'devnet') return 'local'
  return 'mainnet'
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if `account` already holds an ARC-72 token for `appId` (contractId).
 * Uses the NFTNavigator ARC-72 indexer.
 */
export async function hasAchievement(account: string, appId: number): Promise<boolean> {
  const net = getNet()
  const base =
    net === 'testnet'
      ? 'https://arc72-voi-testnet.nftnavigator.xyz/nft-indexer/v1'
      : 'https://arc72-voi-mainnet.nftnavigator.xyz/nft-indexer/v1'

  type TokenRow = { contractId: number; owner: string; isBurned?: boolean }
  type Resp = { tokens?: TokenRow[] }

  const url = new URL(`${base}/tokens`)
  url.searchParams.set('contractId', String(appId))
  url.searchParams.set('owner', account)

  // tiny typed fetch
  const fetchJson = async <T>(u: string, timeoutMs = 6000): Promise<T> => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(u, { signal: ctrl.signal, headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } finally {
      clearTimeout(t)
    }
  }

  log('hasAchievement query', { appId, account, url: url.toString() })
  try {
    const data = await fetchJson<Resp>(url.toString())
    const rows = Array.isArray(data.tokens) ? data.tokens : []
    const has =
      rows.some(
        (r) => Number(r.contractId) === Number(appId) && r.owner === account && !r.isBurned
      )
    log('hasAchievement result', { has, count: rows.length })
    return has
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('hasAchievement error', { msg })
    return false
  }
}

/**
 * Stubbed mint function:
 * - logs inputs and environment flags
 * - returns a fake txid (string)
 * - performs no network calls, no signing, no SDK usage
 *
 * Keep the same signature so other code doesn’t break.
 */
export async function mintSBT(appId: number, account: string): Promise<string> {
  const debug = (process.env.DEBUG || '').toLowerCase() === 'true'
  const simulate = (process.env.SIMULATE || '').toLowerCase() === 'true'

  log('mintSBT (stub) called', { appId, account, debug, simulate })
  const fake = `stub-${appId}-${Date.now().toString(36)}`
  log('mintSBT (stub) returning fake txid', { txid: fake })
  return fake
}
