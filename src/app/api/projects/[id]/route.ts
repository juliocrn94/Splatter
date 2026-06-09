import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

// PATCH /api/projects/[id] — editar nombre y/o cliente
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(req)
  if (authError) return authError

  const { id } = await params
  const { name, clientName } = await req.json()

  if (!name && !clientName) {
    return NextResponse.json({ error: 'Al menos un campo requerido' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const updates: Record<string, string> = {}
  if (name)       updates.name        = name
  if (clientName) updates.client_name = clientName

  const { data, error } = await db
    .from('projects')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[PATCH /api/projects/:id]', { id, error: error.message })
    return NextResponse.json({ error: 'No se pudo actualizar el proyecto' }, { status: 500 })
  }

  return NextResponse.json({ project: data })
}

// DELETE /api/projects/[id] — eliminar proyecto
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(req)
  if (authError) return authError

  const { id } = await params
  const db = supabaseAdmin()

  const { data: project, error: fetchErr } = await db
    .from('projects')
    .select('id, status')
    .eq('id', id)
    .single()

  if (fetchErr || !project) {
    return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  }

  if (project.status === 'processing' || project.status === 'reprocessing') {
    return NextResponse.json(
      { error: `No se puede eliminar un proyecto en estado "${project.status}"` },
      { status: 409 }
    )
  }

  const { error } = await db.from('projects').delete().eq('id', id)

  if (error) {
    console.error('[DELETE /api/projects/:id]', { id, error: error.message })
    return NextResponse.json({ error: 'No se pudo eliminar el proyecto' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
