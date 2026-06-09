import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, generateProjectCode } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { name, clientName, city = 'CDMX' } = await req.json()

  if (!name || !clientName) {
    return NextResponse.json({ error: 'name y clientName son requeridos' }, { status: 400 })
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
    })
    .select()
    .single()

  if (error || !project) {
    return NextResponse.json({ error: 'No se pudo crear el proyecto' }, { status: 500 })
  }

  return NextResponse.json({ project })
}
