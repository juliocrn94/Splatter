import { NextRequest, NextResponse } from 'next/server'

// Rutas públicas — no requieren autenticación
const PUBLIC_PREFIXES = ['/tour/', '/login']
const PUBLIC_API_PREFIXES = ['/api/webhook/']

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))
  )
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  // La cookie operator_token almacena la contraseña del operador (httpOnly + secure + sameSite=strict)
  const token = req.cookies.get('operator_token')?.value
  if (token && token === process.env.OPERATOR_PASSWORD) return NextResponse.next()

  const loginUrl = new URL('/login', req.url)
  loginUrl.searchParams.set('next', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
