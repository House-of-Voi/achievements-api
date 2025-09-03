// src/lib/utils/voi/index.ts
/**
 * STUB IMPLEMENTATION (no chain calls).
 * Logs what would happen so you can verify flow end-to-end.
 *
 * When you're ready to wire real chain logic, swap these bodies
 * with actual SDK/indexer calls.
 */

// Tiny log helper with timestamp
const LOG_PREFIX = '[voi:stub]'
const nowIso = () => new Date().toISOString()
const log = (msg: string, data?: Record<string, unknown>) => {
  if (data) console.log(`${LOG_PREFIX} ${nowIso()} ${msg}`, data)
  else console.log(`${LOG_PREFIX} ${nowIso()} ${msg}`)
}

/**
 * Check if an account already holds the SBT for a given asset.
 * STUB: always returns false.
 */
export async function hasAchievement(account: string, assetId: number): Promise<boolean> {
  log('hasAchievement called', { account, assetId })
  // In the real impl, you would query the indexer for ASA holdings.
  const result = false
  log('hasAchievement result', { result })
  return result
}

/**
 * Mint the SBT by calling the ARC-72 app.
 * STUB: logs intent and returns a fake tx id.
 */
export async function mintSBT(appId: number, account: string): Promise<string> {
  const txid = `stub-tx-${appId}-${Date.now().toString(36)}`
  log('mintSBT called', { appId, account })
  // Real impl would:
  // 1) build app call txn (appArgs: ["mint", decodeAddress(account).publicKey])
  // 2) sign with signer sk
  // 3) send & wait for confirmation
  log('mintSBT returning fake tx id', { txid })
  return txid
}

/**
 * Read the ARC-72 app's global state to find the SBT asset id.
 * STUB: logs and returns 0.
 */
export async function getSBTAssetId(appId: number): Promise<number> {
  log('getSBTAssetId called', { appId })
  // TODO: Implement real 
  const assetId = 0
  log('getSBTAssetId result', { assetId })
  return assetId
}
