// src/app/api/claim/route.ts
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import * as algosdk from 'algosdk'
import type { IAchievement } from '@/lib/types'
import * as utils from '@/lib/utils/voi'
import type { paths, components } from '@/types/openapi'

const ACH_DIR = path.join(process.cwd(), 'src/lib/achievements')

// ----- light logger (keep route logs minimal; heavy logs are inside the achievement files) -----
const LP = '[claim]'
const nowIso = () => new Date().toISOString()
const slog = (msg: string, data?: Record<string, unknown>) =>
  (data ? console.log(`${LP} ${nowIso()} ${msg}`, data) : console.log(`${LP} ${nowIso()} ${msg}`))

// Type-safe shape guard (no "any")
function isAchievement(x: unknown): x is IAchievement {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.description === 'string' &&
    typeof o.getContractAppId === 'function' &&
    typeof o.checkRequirement === 'function' &&
    typeof o.mint === 'function'
  )
}

// Load all achievements; support modules exporting a single item OR an array
async function loadAchievements(): Promise<IAchievement[]> {
  const files = fs.readdirSync(ACH_DIR).filter((f) => f.endsWith('.ts'))
  slog('Loading achievement modules', { count: files.length })

  const lists = await Promise.all(
    files.map(async (f) => {
      const base = f.replace(/\.ts$/, '')
      const mod = await import(
        /* webpackInclude: /\.ts$/ */
        /* webpackMode: "lazy" */
        `@/lib/achievements/${base}.ts`
      )
      const raw = (mod.default ?? mod) as unknown
      const arr = Array.isArray(raw) ? raw : [raw]
      return arr
    })
  )

  // Normalize flags; default enabled:true, hidden:false
  const all = lists.flat().map((a) => ({
    enabled: (a as IAchievement)?.enabled ?? true,
    hidden: (a as IAchievement)?.hidden ?? false,
    ...(a as IAchievement),
  }))

  slog('Loaded achievements', { total: all.length })
  return all
}

// Normalize the result of checkRequirement() so we never rely on object truthiness.
async function getEligibility(
  item: IAchievement,
  account: string
): Promise<{ eligible: boolean; progress?: number }> {
  const res = await item.checkRequirement(account as string)
  if (typeof res === 'boolean') return { eligible: res }
  if (res && typeof res === 'object' && 'eligible' in res) {
    const r = res as { eligible: unknown; progress?: unknown }
    return {
      eligible: !!r.eligible,
      progress: typeof r.progress === 'number' ? r.progress : undefined,
    }
  }
  return { eligible: false }
}

export async function POST(req: NextRequest) {
  type Body = paths['/api/claim']['post']['requestBody']['content']['application/json']
  type Ok = paths['/api/claim']['post']['responses']['200']['content']['application/json']
  type Err = components['schemas']['Error']

  const body = (await req.json()) as Body
  const bag = body as unknown as Record<string, unknown>
  const account = bag['account'] as string | undefined
  const requestedId = (bag['id'] as string | undefined)?.trim() || undefined

  slog('Incoming claim request', { account, requestedId: requestedId ?? '(all)' })

  if (!account || !algosdk.isValidAddress(account)) {
    slog('Invalid account', { account })
    return NextResponse.json<Err>({ error: 'Invalid account' }, { status: 400 })
  }

  const all = await loadAchievements()

  // Select targets:
  // - if `requestedId` provided, only claim that one (if it exists)
  // - else process all
  let targets: IAchievement[] = all
  if (requestedId) {
    const one = all.find((a) => a.id === requestedId)
    if (!one) {
      const notFound: Ok = { minted: [], errors: [{ id: requestedId, reason: 'Not found' }] }
      slog('Requested id not found', { requestedId })
      return NextResponse.json(notFound)
    }
    targets = [one]
  }

  const result: Ok = { minted: [], errors: [] }

  for (const item of targets) {
    const id = (item as IAchievement)?.id ?? '(unknown)'

    try {
      if (!isAchievement(item)) {
        const reason = 'Invalid achievement export (missing required methods)'
        slog('Skip (invalid shape)', { id, reason })
        result.errors.push({ id, reason })
        continue
      }

      if (!item.enabled) {
        slog('Skip (disabled)', { id })
        // Only add an error if single-id was requested, to keep parity with previous behavior
        if (requestedId) result.errors.push({ id, reason: 'Disabled' })
        continue
      }

      const appId = item.getContractAppId()
      slog('Pre-check', { id, account, appId })

      if (!appId) {
        const reason = 'No contract appId configured for this network'
        slog('Skip (no appId)', { id })
        if (requestedId) result.errors.push({ id, reason })
        continue
      }

      // Ownership check first
      const owned = await utils.hasAchievement(account, appId)
      slog('Owned check', { id, account, appId, owned })
      if (owned) {
        slog('Skip (already has achievement)', { id, account, appId })
        if (requestedId) result.errors.push({ id, reason: 'Already minted' })
        continue
      }

      // Eligibility (FIX: use .eligible, not object truthiness)
      const { eligible, progress } = await getEligibility(item, account)
      slog('Eligibility check', { id, account, eligible, progress })
      if (!eligible) {
        slog('Skip (not eligible)', { id, account, progress })
        if (requestedId) result.errors.push({ id, reason: 'Not eligible' })
        continue
      }

      // Mint
      const txnId = await item.mint(account)
      slog('Mint success', { id, account, txnId })
      result.minted.push({ id, txnId })
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Unknown error'
      slog('Mint error', { id, account, reason })
      result.errors.push({ id, reason })
    }
  }

  slog('Claim summary', { minted: result.minted.length, errors: result.errors.length })
  return NextResponse.json(result)
}
