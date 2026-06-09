import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (!password || password !== (process.env.OPERATOR_PASSWORD ?? "").trim()) {
    return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
  }

  const isProd   = process.env.NODE_ENV === 'production'
  const response = NextResponse.json({ ok: true })

  // Guardar la contraseña directamente en la cookie (httpOnly + secure + sameSite=strict)
  response.cookies.set('operator_token', password, {
    httpOnly:  true,
    secure:    isProd,
    sameSite:  'strict',
    maxAge:    60 * 60 * 24 * 30, // 30 días
    path:      '/',
  })

  return response
}
