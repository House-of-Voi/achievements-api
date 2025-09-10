import { NextResponse } from 'next/server'
import type { IAchievement } from '@/lib/types'
import * as utils from '@/lib/utils/voi'
import fs from 'fs'
import path from 'path'
import type { paths, components } from '@/types/openapi'
import { absolutePublicUrl, relImageFromId } from '@/lib/utils/assets'

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

  // ---- shared progress context (left generic) ----
  // Achievements can populate this object on first use (e.g., ctx.currentUsd).
  const ctx: Record<string, unknown> = {}

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

  // Helper to run the upgraded requirement (supports boolean or object return)
  type RequirementResult = boolean | { eligible: boolean; progress?: number }
  type CheckWithCtx = (account: string, ctx?: Record<string, unknown>) => Promise<RequirementResult>

  const runRequirement = async (a: IAchievement): Promise<{ eligible: boolean; progress: number }> => {
    if (!account) return { eligible: false, progress: 0 }
    try {
      const check = a.checkRequirement as unknown as CheckWithCtx
      const result = await check(account, ctx)
      if (typeof result === 'boolean') {
        return { eligible: result, progress: result ? 1 : 0 }
      }
      const eligible = !!result.eligible
      const progress =
        typeof result.progress === 'number'
          ? Math.max(0, Math.min(1, result.progress))
          : eligible ? 1 : 0
      return { eligible, progress }
    } catch {
      return { eligible: false, progress: 0 }
    }
  }

  // --- SINGLE-ITEM MODE ---
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
      const [has, reqRes] = await Promise.all([
        utils.hasAchievement(account, appId).catch(() => false),
        runRequirement(a),
      ])
      owned = has
      eligible = reqRes.eligible
      progress = owned ? 1 : reqRes.progress
    }

    const one = toMeta(a, owned, eligible, progress)
    return NextResponse.json<Ok>(one as unknown as Ok)
  }

  // --- LIST MODE ---
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
    ownership   = results.map(r => r.owned)
    eligArr     = results.map(r => r.eligible)
    progressArr = results.map(r => r.progress)
  } else {
    ownership   = new Array(list.length).fill(false)
    eligArr     = new Array(list.length).fill(false)
    progressArr = new Array(list.length).fill(0)
  }

  // Hidden gating
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
