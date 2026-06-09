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
  const { name, clientName, isLocked, contactPhone } = await req.json()

  if (!name && !clientName && typeof isLocked !== 'boolean' && !contactPhone) {
    return NextResponse.json({ error: 'Al menos un campo requerido' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const updates: Record<string, string | boolean> = {}
  if (name)                          updates.name          = name
  if (clientName)                    updates.client_name   = clientName
  if (typeof isLocked === 'boolean') updates.is_locked     = isLocked
  if (contactPhone)                  updates.contact_phone = contactPhone

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

// DELETE /api/projects/[id] — soft delete
// El registro NUNCA se borra físicamente para preservar el project_code
// y mantener el contador de identificadores monotónico.
// El proyecto queda con status='deleted' y deleted_at timestamp.
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
    .select('id, status, project_code')
    .eq('id', id)
    .single()

  if (fetchErr || !project) {
    return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  }

  if (project.status === 'processing' || project.status === 'reprocessing') {
    return NextResponse.json(
      { error: `No se puede eliminar un proyecto en procesamiento. Espera a que termine o usa el watchdog.` },
      { status: 409 }
    )
  }

  if (project.status === 'deleted') {
    return NextResponse.json({ ok: true }) // idempotente
  }

  // Soft delete: marca como eliminado, nunca borra el registro
  const { error } = await db.from('projects').update({
    status:     'deleted',
    deleted_at: new Date().toISOString(),
    is_locked:  true, // bloquear el tour público automáticamente
  }).eq('id', id)

  if (error) {
    console.error('[DELETE /api/projects/:id]', { id, projectCode: project.project_code, error: error.message })
    return NextResponse.json({ error: 'No se pudo eliminar el proyecto' }, { status: 500 })
  }

  console.log('[DELETE /api/projects/:id] Soft delete:', { id, projectCode: project.project_code })
  return NextResponse.json({ ok: true })
}
