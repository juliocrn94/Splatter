import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/ratelimit'
import { addSession } from '@/lib/sessions'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const { allowed, retryAfter } = checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera 15 minutos.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const { password } = await req.json()

  if (!password || password !== (process.env.OPERATOR_PASSWORD ?? '').trim()) {
    return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
  }

  const token = randomUUID()
  addSession(token)

  const isProd   = process.env.NODE_ENV === 'production'
  const response = NextResponse.json({ ok: true })

  response.cookies.set('operator_token', token, {
    httpOnly:  true,
    secure:    isProd,
    sameSite:  'strict',
    maxAge:    60 * 60 * 24 * 30, // 30 días
    path:      '/',
  })

  return response
}
