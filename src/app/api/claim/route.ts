// app/api/achievements/claim/route.ts
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import * as algosdk from 'algosdk'
import type { IAchievement } from '@/lib/types'
import * as utils from '@/lib/utils/voi'

// OpenAPI-generated types
import type { paths, components } from '@/types/openapi'

const ACH_DIR = path.join(process.cwd(), 'src/lib/achievements')

async function loadAchievements(): Promise<IAchievement[]> {
  const files = fs.readdirSync(ACH_DIR).filter((f) => f.endsWith('.ts'))

  const mods = await Promise.all(
    files.map(async (f) => {
      const base = f.replace(/\.ts$/, '')
      // Let the bundler pre-build a context of possible modules in this folder.
      const mod = await import(
        /* webpackInclude: /\.ts$/ */
        /* webpackMode: "lazy" */
        `@/lib/achievements/${base}.ts`
      )
      const ach = { ...(mod.default as IAchievement) }
      ach.enabled = ach.enabled ?? true
      ach.hidden = ach.hidden ?? false
      return ach
    })
  )

  return mods
}

export async function POST(req: NextRequest) {
  type Body = paths['/api/claim']['post']['requestBody']['content']['application/json']
  type Ok   = paths['/api/claim']['post']['responses']['200']['content']['application/json']
  type Err  = components['schemas']['Error']

  const { account } = (await req.json()) as Body

  if (!algosdk.isValidAddress(account)) {
    return NextResponse.json<Err>({ error: 'Invalid account' }, { status: 400 })
  }

  const achievements = await loadAchievements()
  const result: Ok = { minted: [], errors: [] }

  for (const ach of achievements) {
    try {
      if (!ach.enabled) continue
      const appId = ach.getContractAppId()
      const assetId = await utils.getSBTAssetId(appId)
      if (await utils.hasAchievement(account, assetId)) continue
      if (!(await ach.checkRequirement(account))) continue
      const txnId = await ach.mint(account)
      result.minted.push({ id: ach.id, txnId })
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Unknown error'
      result.errors.push({ id: ach.id, reason })
    }
  }

  return NextResponse.json(result)
}
