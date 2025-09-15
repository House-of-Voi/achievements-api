// src/app/api/achievements/route.ts
import { NextResponse } from 'next/server'
import type { IAchievement } from '@/lib/types'
import * as utils from '@/lib/utils/voi'
import fs from 'fs'
import path from 'path'
import type { paths, components } from '@/types/openapi'
import { absolutePublicUrl, relImageFromId } from '@/lib/utils/assets'

const ACH_DIR = path.join(process.cwd(), 'src/lib/achievements')

// ---------- tiny logger ----------
const LP = '[route:achievements]'
const nowIso = () => new Date().toISOString()
const log = (msg: string, data?: Record<string, unknown>) =>
  data ? console.log(`${LP} ${nowIso()} ${msg}`, data) : console.log(`${LP} ${nowIso()} ${msg}`)

// ---------- helpers ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// simple promise pool (no deps)
async function promisePool<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  let active = 0
  return new Promise((resolve, reject) => {
    const launch = () => {
      while (active < concurrency && i < items.length) {
        const idx = i++
        active++
        worker(items[idx], idx)
          .then((res) => {
            out[idx] = res
            active--
            if (i === items.length && active === 0) resolve(out)
            else launch()
          })
          .catch(reject)
      }
    }
    launch()
  })
}

// retry wrapper with jittered backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  meta: Record<string, unknown>,
  retries = Number(process.env.ACH_RETRIES ?? 3)
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    const t0 = Date.now()
    try {
      const res = await fn()
      log(`${label} ok`, { ...meta, ms: Date.now() - t0, attempt })
      return res
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      log(`${label} fail`, { ...meta, attempt, msg })
      if (attempt < retries) {
        const base = 150 * Math.pow(2, attempt - 1)
        const jitter = Math.floor(Math.random() * 120)
        await sleep(base + jitter)
      }
    }
  }
  throw lastErr
}

function isVoiAddressFormat(addr: string): boolean {
  return /^[A-Z2-7]{58}$/.test(addr)
}

let cached: IAchievement[] | null = null

async function loadAchievements(): Promise<IAchievement[]> {
  if (cached) return cached
  const files = fs.readdirSync(ACH_DIR).filter((f) => f.endsWith('.ts'))
  const lists = await Promise.all(
    files.map(async (f) => {
      const base = f.replace(/\.ts$/, '')
      const mod = await import(`@/lib/achievements/${base}.ts`)
      const raw = (mod.default ?? mod) as IAchievement | IAchievement[]
      const arr = Array.isArray(raw) ? raw : [raw]
      return arr.map((a) => ({ enabled: true, hidden: false, ...a }))
    })
  )
  cached = lists.flat().filter((a) => a.enabled)
  log('Loaded achievements', { count: cached.length })
  return cached
}

export async function GET(req: Request) {
  type QueryOpt = paths['/api/achievements']['get']['parameters']['query']
  type QueryRaw = NonNullable<QueryOpt>
  type Ok       = paths['/api/achievements']['get']['responses']['200']['content']['application/json']
  type One      = components['schemas']['AchievementMetadata']
  type Err      = components['schemas']['Error']
  type Category = NonNullable<QueryRaw['category']>

  const CAT_VALUES: readonly Category[] =
    ['wagering','wins','losses','loyalty','lp','community','game', 'tournament'] as const
  const parseCategory = (v: string | null): Category | undefined =>
    CAT_VALUES.includes(v as Category) ? (v as Category) : undefined

  const url = new URL(req.url)
  const id        = url.searchParams.get('id')        ?? undefined
  const account   = url.searchParams.get('account')   ?? undefined
  const category  = parseCategory(url.searchParams.get('category'))
  const seriesKey = url.searchParams.get('seriesKey') ?? undefined
  const game      = url.searchParams.get('game')      ?? undefined

  log('Incoming request', { id, account, category, seriesKey, game })

  if (account && !isVoiAddressFormat(account)) {
    log('Invalid account format', { account })
    return NextResponse.json<Err>({ error: 'Invalid account' }, { status: 400 })
  }

  const achievements = await loadAchievements()

  const ctx: Record<string, unknown> = {}

  const toMeta = (
    a: IAchievement,
    owned?: boolean,
    eligible?: boolean,
    progress?: number
  ): One & { owned?: boolean; eligible?: boolean; progress?: number } => {
    const scope =
      a.display?.scope
        ? (a.display.scope.kind === 'game'
            ? { kind: 'game' as const, gameKey: a.display.scope.gameKey, gameName: a.display.scope.gameName }
            : { kind: 'global' as const })
        : undefined

    const relImg = a.imageUrl ?? relImageFromId(a.id)
    const imgAbs = absolutePublicUrl(req, relImg)

    const base: One = {
      id: a.id,
      name: a.name,
      description: a.description,
      imageUrl: imgAbs,
      display: a.display
        ? {
            category:  a.display.category,
            series:    a.display.series,
            seriesKey: a.display.seriesKey,
            tier:      a.display.tier,
            tiersTotal:a.display.tiersTotal,
            order:     a.display.order,
            tags:      a.display.tags,
            scope,
          }
        : undefined,
    }

    return account ? { ...base, owned: !!owned, eligible: !!eligible, progress } : base
  }

  // Requirement adapter
  type RequirementResult = boolean | { eligible: boolean; progress?: number }
  type CheckWithCtx = (account: string, ctx?: Record<string, unknown>) => Promise<RequirementResult>

  const runRequirement = async (a: IAchievement): Promise<{ eligible: boolean; progress: number }> => {
    if (!account) return { eligible: false, progress: 0 }
    try {
      const check = a.checkRequirement as unknown as CheckWithCtx
      const result = await check(account, ctx)
      if (typeof result === 'boolean') {
        log('Requirement (bool)', { id: a.id, eligible: result })
        return { eligible: result, progress: result ? 1 : 0 }
      }
      const eligible = !!result.eligible
      const progress =
        typeof result.progress === 'number'
          ? Math.max(0, Math.min(1, result.progress))
          : eligible ? 1 : 0
      log('Requirement (obj)', { id: a.id, eligible, progress })
      return { eligible, progress }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('Requirement error', { id: a.id, msg })
      return { eligible: false, progress: 0 }
    }
  }

  // Ownership check with skip, memo, concurrency-friendly retry
  type OwnedRes = { owned: boolean; appId: number }
  const ownMemo = new Map<string, OwnedRes>()
  const checkOwned = async (a: IAchievement): Promise<OwnedRes> => {
    const appId = a.getContractAppId()
    if (!account) {
      log('Owned check skipped (no account)', { id: a.id, appId })
      return { owned: false, appId }
    }
    if (!appId || appId === 0) {
      log('Owned check skipped (appId=0)', { id: a.id, appId })
      return { owned: false, appId }
    }
    const key = `${account}:${appId}`
    const memo = ownMemo.get(key)
    if (memo) {
      log('Owned check memo hit', { id: a.id, appId, owned: memo.owned })
      return memo
    }
    log('Owned check start', { id: a.id, appId, account })
    try {
      const owned = await withRetry(
        () => utils.hasAchievement(account, appId),
        'Owned check fetch',
        { id: a.id, appId }
      )
      log('Owned check result', { id: a.id, appId, owned })
      const res = { owned, appId }
      ownMemo.set(key, res)
      return res
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('Owned check giving up', { id: a.id, appId, msg })
      return { owned: false, appId }
    }
  }

  // --- SINGLE-ITEM MODE ---
  if (id) {
    const a = achievements.find((x) => x.id === id)
    if (!a) {
      log('Not found', { id })
      return NextResponse.json<Err>({ error: 'Not found' }, { status: 404 })
    }

    let owned = false
    let eligible = false
    let progress = 0

    if (account) {
      const [{ owned: has }, reqRes] = await Promise.all([
        checkOwned(a),
        runRequirement(a),
      ])
      owned = has
      eligible = reqRes.eligible
      progress = owned ? 1 : reqRes.progress
      log('Single item results', { id: a.id, owned, eligible, progress })
    }

    const one = toMeta(a, owned, eligible, progress)
    return NextResponse.json<Ok>(one as unknown as Ok)
  }

  // --- LIST MODE ---
  let list = achievements
  if (category) list = list.filter((a) => a.display?.category === category)
  if (seriesKey) list = list.filter((a) => a.display?.seriesKey === seriesKey)
  if (game) {
    list = list.filter((a) => a.display?.scope?.kind === 'game' && a.display.scope.gameKey === game)
  }

  log('List mode selection', { total: achievements.length, filtered: list.length, category, seriesKey, game })

  const conc = Math.max(1, Number(process.env.ACH_CONCURRENCY ?? 4))

  type ItemRes = { owned: boolean; eligible: boolean; progress: number }
  let results: ItemRes[]

  if (account) {
    results = await promisePool(
      list,
      async (a) => {
        const [{ owned }, req] = await Promise.all([checkOwned(a), runRequirement(a)])
        const progress = owned ? 1 : req.progress
        log('List item results', { id: a.id, owned, eligible: req.eligible, progress })
        return { owned, eligible: req.eligible, progress }
      },
      conc
    )
  } else {
    results = list.map(() => ({ owned: false, eligible: false, progress: 0 }))
  }

  // Hidden gating
  const visible: Array<{ a: IAchievement; r: ItemRes }> = []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    const r = results[i]
    const show = a.hidden ? r.owned : true
    if (!show) log('Hidden gated (omitted)', { id: a.id, hidden: a.hidden, owned: r.owned })
    else visible.push({ a, r })
  }

  // Build and sort
  const body = visible
    .map(({ a, r }) => toMeta(a, r.owned, r.eligible, r.progress) as One)
    .sort((x, y) => {
      const sx = x.display?.seriesKey ?? ''
      const sy = y.display?.seriesKey ?? ''
      if (sx !== sy) return sx.localeCompare(sy)
      const tx = x.display?.tier ?? 0
      const ty = y.display?.tier ?? 0
      if (tx !== ty) return tx - ty
      return x.name.localeCompare(y.name)
    })

  // Summary
  if (account) {
    const ownedCount   = results.filter((r) => r.owned).length
    const eligibleOnly = results.filter((r) => r.eligible && !r.owned).length
    log('List summary', { totalReturned: body.length, ownedCount, eligibleNotOwned: eligibleOnly, concurrency: conc })
  } else {
    log('List summary (no account)', { totalReturned: body.length })
  }

  return NextResponse.json<Ok>(body as Ok)
}
