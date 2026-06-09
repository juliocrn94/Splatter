import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(req)
  if (authError) return authError

  const { id } = await params

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  }
  const db = supabaseAdmin()

  const { data: project, error } = await db
    .from('projects')
    .select('id, status')
    .eq('id', id)
    .single()

  if (error || !project) {
    return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  }

  if (project.status !== 'reviewing') {
    return NextResponse.json(
      { error: `Solo se puede aprobar un proyecto en revisión (estado actual: ${project.status})` },
      { status: 409 }
    )
  }

  await db
    .from('projects')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
