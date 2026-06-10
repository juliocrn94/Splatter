import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_EXTRACTORS = ['sift', 'superpoint']
const VALID_TRAINERS   = ['opensplat', 'gsplat']

// PATCH /api/projects/[id]/config — actualiza feature_extractor y/o trainer del proyecto
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth(req)
  if (authError) return authError

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const body = await req.json()
  const updates: Record<string, string> = {}

  if (body.feature_extractor !== undefined) {
    if (!VALID_EXTRACTORS.includes(body.feature_extractor))
      return NextResponse.json({ error: 'feature_extractor inválido' }, { status: 400 })
    updates.feature_extractor = body.feature_extractor
  }

  if (body.trainer !== undefined) {
    if (!VALID_TRAINERS.includes(body.trainer))
      return NextResponse.json({ error: 'trainer inválido' }, { status: 400 })
    updates.trainer = body.trainer
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })

  const db = supabaseAdmin()
  const { data, error } = await db
    .from('projects')
    .update(updates)
    .eq('id', id)
    .select('id, feature_extractor, trainer')
    .single()

  if (error || !data) {
    console.error('[/api/projects/config] Error:', error?.message)
    return NextResponse.json({ error: 'No se pudo actualizar la configuración' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, ...data })
}
