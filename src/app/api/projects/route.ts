import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, generateProjectCode } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

const ALLOWED_CITIES = ['CDMX', 'GDL', 'MTY', 'QRO', 'PUE', 'MER', 'CUN', 'TIJ', 'LEO', 'SLP']

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req)
  if (authError) return authError

  const { name, clientName, city = 'CDMX', feature_extractor = 'sift', trainer = 'opensplat' } = await req.json()

  if (!name || !clientName) {
    return NextResponse.json({ error: 'name y clientName son requeridos' }, { status: 400 })
  }

  if (typeof name !== 'string' || name.length > 200) {
    return NextResponse.json({ error: 'name debe ser máximo 200 caracteres' }, { status: 400 })
  }

  if (typeof clientName !== 'string' || clientName.length > 200) {
    return NextResponse.json({ error: 'clientName debe ser máximo 200 caracteres' }, { status: 400 })
  }

  if (!ALLOWED_CITIES.includes(city)) {
    return NextResponse.json({ error: `Ciudad no permitida. Ciudades válidas: ${ALLOWED_CITIES.join(', ')}` }, { status: 400 })
  }

  const db = supabaseAdmin()

  // Generar código único incremental: SPL-CDMX-00001-A
  const projectCode = await generateProjectCode(city)

  // Slug URL-safe desde el nombre
  const slug = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    + '-' + Date.now().toString(36)

  const { data: project, error } = await db
    .from('projects')
    .insert({
      name,
      client_name: clientName,
      slug,
      project_code: projectCode,
      city,
      status: 'uploading',
      feature_extractor: ['sift', 'superpoint'].includes(feature_extractor) ? feature_extractor : 'sift',
      trainer: ['opensplat', 'gsplat'].includes(trainer) ? trainer : 'opensplat',
    })
    .select()
    .single()

  if (error || !project) {
    console.error('[/api/projects] Error al insertar proyecto:', {
      name, clientName, city, projectCode, slug,
      error: error?.message, code: error?.code, details: error?.details,
    })
    return NextResponse.json({ error: 'No se pudo crear el proyecto' }, { status: 500 })
  }

  return NextResponse.json({ project })
}
