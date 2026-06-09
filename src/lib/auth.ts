import { isValidSession } from './sessions'
import { NextRequest, NextResponse } from 'next/server'

export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  const token = req.cookies.get('operator_token')?.value
  if (!token || !(await isValidSession(token))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  return null
}
