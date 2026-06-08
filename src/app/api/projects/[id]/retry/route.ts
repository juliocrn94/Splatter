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

  if (project.status !== 'failed') {
    return NextResponse.json(
      { error: `Solo se puede reintentar un proyecto fallido (estado actual: ${project.status})` },
      { status: 409 }
    )
  }

  await db
    .from('projects')
    .update({ status: 'uploading', error_message: null })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
