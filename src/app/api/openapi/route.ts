import fs from 'fs'
import path from 'path'

export async function GET() {
  const specPath = path.join(process.cwd(), 'openapi.json')
  try {
    const json = fs.readFileSync(specPath, 'utf-8')
    return new Response(json, { headers: { 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'openapi.json not found' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}