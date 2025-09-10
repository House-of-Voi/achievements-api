// src/app/api/achievements/route.ts
import { NextResponse } from 'next/server'
import type { IAchievement } from '@/lib/types'
import * as utils from '@/lib/utils/voi'
import fs from 'fs'
import path from 'path'
import type { paths, components } from '@/types/openapi'
import { absolutePublicUrl, relImageFromId } from '@/lib/utils/assets'

// Precompute context for Original Degens (USD progress) once per request.
// This import is safe even if other achievements don't use it.
import achievementsFromOriginalDegens, { getTotalWagerUsd as getTotalWagerUsdOriginal } from '@/lib/achievements/original-degens'

const ACH_DIR = path.join(process.cwd(), 'src/lib/achievements')

// Minimal VOI address format check (58 chars, A–Z and 2–7). No checksum.
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
      const mod = await import(
        /* webpackInclude: /\.ts$/ */
        /* webpackMode: "lazy" */
        `@/lib/achievements/${base}.ts`
      )
      const raw = (mod.default ?? mod) as IAchievement | IAchievement[]
      const arr = Array.isArray(raw) ? raw : [raw]
      return arr.map((a) => ({ enabled: true, hidden: false, ...a }))
    })
  )

  cached = lists.flat().filter((a) => a.enabled)
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
    ['wagering','wins','losses','loyalty','lp','community','game'] as const

  const parseCategory = (v: string | null): Category | undefined =>
    CAT_VALUES.includes(v as Category) ? (v as Category) : undefined

  const url = new URL(req.url)
  const id        = url.searchParams.get('id')        ?? undefined
  const account   = url.searchParams.get('account')   ?? undefined
  const category  = parseCategory(url.searchParams.get('category'))
  const seriesKey = url.searchParams.get('seriesKey') ?? undefined
  const game      = url.searchParams.get('game')      ?? undefined

  if (account && !isVoiAddressFormat(account)) {
    return NextResponse.json<Err>({ error: 'Invalid account' }, { status: 400 })
  }

  const achievements = await loadAchievements()

  // ---- shared progress context (compute once when possible) ----
  // We may have achievements that need a common computed value.
  // For Original Degens we compute currentUsd once; others can ignore it.
  const ctx: Record<string, unknown> = {}
  if (account) {
    try {
      ctx.currentUsd = await getTotalWagerUsdOriginal(account)
    } catch {
      ctx.currentUsd = 0
    }
  }

  // convert internal model -> API metadata (and make image URL absolute)
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
      imageUrl: imgAbs, // absolute for consumers
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

    // Include owned/eligible/progress only when an account was provided
    return account ? { ...base, owned: !!owned, eligible: !!eligible, progress } : base
  }

  // Helper to run the upgraded requirement (supports boolean or object return)
  const runRequirement = async (a: IAchievement): Promise<{ eligible: boolean; progress: number }> => {
    if (!account) return { eligible: false, progress: 0 }

    try {
      // We pass ctx even if older achievements ignore it; cast to keep this file drop-in.
      const result = await (a as any).checkRequirement(account, ctx)

      if (typeof result === 'boolean') {
        return { eligible: result, progress: result ? 1 : 0 }
      }
      const eligible = !!result?.eligible
      const progress =
        typeof result?.progress === 'number'
          ? Math.max(0, Math.min(1, result.progress))
          : eligible ? 1 : 0
      return { eligible, progress }
    } catch {
      return { eligible: false, progress: 0 }
    }
  }

  // --- SINGLE-ITEM MODE: always return the achievement by id, even if hidden ---
  if (id) {
    const a = achievements.find(x => x.id === id)
    if (!a) {
      return NextResponse.json<Err>({ error: 'Not found' }, { status: 404 })
    }

    let owned = false
    let eligible = false
    let progress = 0

    if (account) {
      const appId = a.getContractAppId()
      const [has, req] = await Promise.all([
        utils.hasAchievement(account, appId).catch(() => false),
        runRequirement(a),
      ])
      owned = has
      eligible = req.eligible
      progress = owned ? 1 : req.progress // owned implies 100%
    }

    const one = toMeta(a, owned, eligible, progress)
    // Our OpenAPI 200 is oneOf(single|array) — cast to satisfy TS without regenerating
    return NextResponse.json<Ok>(one as unknown as Ok)
  }

  // --- LIST MODE: filters + normal hidden gating ---
  let list = achievements
  if (category) {
    list = list.filter(a => a.display?.category === category)
  }
  if (seriesKey) {
    list = list.filter(a => a.display?.seriesKey === seriesKey)
  }
  if (game) {
    list = list.filter(a =>
      a.display?.scope?.kind === 'game' && a.display.scope.gameKey === game
    )
  }

  // Ownership + eligibility + progress (only if account provided)
  let ownership: boolean[] = []
  let eligArr: boolean[] = []
  let progressArr: number[] = []

  if (account) {
    const results = await Promise.all(
      list.map(async (a) => {
        const [owned, req] = await Promise.all([
          utils.hasAchievement(account, a.getContractAppId()).catch(() => false),
          runRequirement(a),
        ])
        const progress = owned ? 1 : req.progress
        return { owned, eligible: req.eligible, progress }
      })
    )
    ownership = results.map(r => r.owned)
    eligArr   = results.map(r => r.eligible)
    progressArr = results.map(r => r.progress)
  } else {
    ownership   = new Array(list.length).fill(false)
    eligArr     = new Array(list.length).fill(false)
    progressArr = new Array(list.length).fill(0)
  }

  // Hidden gating: show hidden only if owned; visible always shown
  const visibleIdx: number[] = []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    const show = a.hidden ? ownership[i] : true
    if (show) visibleIdx.push(i)
  }

  const body = visibleIdx.map((i) =>
    toMeta(list[i], ownership[i], eligArr[i], progressArr[i])
  ) as One[]

  body.sort((x, y) => {
    const sx = x.display?.seriesKey ?? ''
    const sy = y.display?.seriesKey ?? ''
    if (sx !== sy) return sx.localeCompare(sy)
    const tx = x.display?.tier ?? 0
    const ty = y.display?.tier ?? 0
    if (tx !== ty) return tx - ty
    return x.name.localeCompare(y.name)
  })

  return NextResponse.json<Ok>(body as Ok)
}
