// src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server'

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://achievements.houseofvoi.com',
  'https://achievements-api.vercel.app'
]

// Compute the Access-Control-Allow-Origin per request
function allowOrigin(req: NextRequest): string {
  const origin = req.headers.get('origin')
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin
  // If you truly want to allow any origin (no credentials), return '*'
  return '*'
}

function corsHeaders(req: NextRequest): HeadersInit {
  const origin = allowOrigin(req)
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    // Only set this if you actually use cookies/auth; if you do, you cannot use '*'
    // 'Access-Control-Allow-Credentials': 'true',
  }
}

export function middleware(req: NextRequest) {
  // Only handle API routes
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()

  // Preflight request: reply immediately
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
  }

  // For normal API calls, pass through but attach CORS headers
  const res = NextResponse.next()
  const headers = corsHeaders(req)
  Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v))
  return res
}

// Apply to API only
export const config = {
  matcher: ['/api/:path*'],
}
