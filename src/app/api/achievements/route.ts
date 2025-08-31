// src/app/api/achievements/route.ts
import { NextResponse } from 'next/server'
import * as algosdk from 'algosdk'
import type { IAchievement } from '@/lib/types'
import * as utils from '@/lib/utils/voi'
import fs from 'fs'
import path from 'path'
import type { paths, components } from '@/types/openapi'

const ACH_DIR = path.join(process.cwd(), 'src/lib/achievements')

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
  type QueryOpt = paths['/api/achievements']['get']['parameters']['query']           // possibly undefined
  type QueryRaw = NonNullable<QueryOpt>                                             // concrete object type
  type Ok       = paths['/api/achievements']['get']['responses']['200']['content']['application/json']
  type Err      = components['schemas']['Error']
  type Category = NonNullable<QueryRaw['category']>

  // narrow category from string|null -> Category|undefined
  const CAT_VALUES: readonly Category[] = ['wagering','wins','losses','loyalty','lp','community','game'] as const
  const parseCategory = (v: string | null): Category | undefined =>
    CAT_VALUES.includes(v as Category) ? (v as Category) : undefined

  const url = new URL(req.url)
  const account   = url.searchParams.get('account')   ?? undefined
  const category  = parseCategory(url.searchParams.get('category'))
  const seriesKey = url.searchParams.get('seriesKey') ?? undefined
  const game      = url.searchParams.get('game')      ?? undefined

  // Build a *non-optional* query object matching QueryRaw
  const query: QueryRaw = { account, category, seriesKey, game }

  if (query.account && !algosdk.isValidAddress(query.account)) {
    return NextResponse.json<Err>({ error: 'Invalid account' }, { status: 400 })
  }

  // pre-filter
  let achievements = await loadAchievements()
  if (query.category) {
    achievements = achievements.filter(a => a.display?.category === query.category)
  }
  if (query.seriesKey) {
    achievements = achievements.filter(a => a.display?.seriesKey === query.seriesKey)
  }
  if (query.game) {
    achievements = achievements.filter(a =>
      a.display?.scope?.kind === 'game' && a.display.scope.gameKey === query.game
    )
  }

  // visibility gating for hidden ones
  const visibility = await Promise.all(
    achievements.map(async (a) => {
      if (!a.hidden) return true
      if (!query.account) return false
      const assetId = await utils.getSBTAssetId(a.getContractAppId())
      return utils.hasAchievement(query.account, assetId)
    })
  )

  // full display metadata
const body = achievements
  .filter((_, i) => visibility[i])
  .map((a) => {
    const scope =
      a.display?.scope
        ? (a.display.scope.kind === 'game'
            ? { kind: 'game' as const, gameKey: a.display.scope.gameKey, gameName: a.display.scope.gameName }
            : { kind: 'global' as const })
        : undefined

    return {
      id: a.id,
      name: a.name,
      description: a.description,
      imageUrl: a.imageUrl ?? undefined,
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
  }) satisfies Ok

  // pretty sort
  body.sort((x, y) => {
    const sx = x.display?.seriesKey ?? ''
    const sy = y.display?.seriesKey ?? ''
    if (sx !== sy) return sx.localeCompare(sy)
    const tx = x.display?.tier ?? 0
    const ty = y.display?.tier ?? 0
    if (tx !== ty) return tx - ty
    return x.name.localeCompare(y.name)
  })

  return NextResponse.json<Ok>(body)
}
