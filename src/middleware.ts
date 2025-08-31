// src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server'

function corsHeaders(req: NextRequest): HeadersInit {
  // Echo requested headers if present; otherwise allow a safe default set.
  const reqHeaders =
    req.headers.get('access-control-request-headers') ??
    'Content-Type, Authorization, X-Requested-With'

  return {
    // Allow ALL origins (NOTE: do not use credentials with "*")
    'Access-Control-Allow-Origin': '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': reqHeaders,
    // Cache preflight up to 24h to cut latency
    'Access-Control-Max-Age': '86400',
    // Expose common headers to browsers (optional)
    'Access-Control-Expose-Headers': 'Content-Type, Content-Length, ETag',
  }
}

export function middleware(req: NextRequest) {
  // Only apply to API routes
  if (!req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Preflight: return immediately
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
  }

  // Normal request: pass through and add CORS headers
  const res = NextResponse.next()
  const headers = corsHeaders(req)
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
  return res
}

export const config = {
  matcher: ['/api/:path*'],
}
