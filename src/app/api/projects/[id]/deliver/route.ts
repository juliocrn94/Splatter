import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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
