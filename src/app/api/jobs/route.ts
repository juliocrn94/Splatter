import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { projectId, videoKey, quality = 'standard' } = await req.json()

  if (!projectId || !videoKey) {
    return NextResponse.json({ error: 'projectId y videoKey son requeridos' }, { status: 400 })
  }

  const db = supabaseAdmin()

  // Verificar que el proyecto existe
  const { data: project, error: fetchErr } = await db
    .from('projects')
    .select('id, status')
    .eq('id', projectId)
    .single()

  if (fetchErr || !project) {
    return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  }

  // Armar la URL del webhook que RunPod llamará al terminar
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/runpod`

  // Disparar job en RunPod serverless
  const runpodRes = await fetch(
    `https://api.runpod.io/v2/${process.env.RUNPOD_ENDPOINT_ID}/run`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          video_r2_key: videoKey,
          project_id:   projectId,
          quality,
          r2_account_id:    process.env.R2_ACCOUNT_ID,
          r2_access_key:    process.env.R2_ACCESS_KEY_ID,
          r2_secret_key:    process.env.R2_SECRET_ACCESS_KEY,
          r2_bucket:        process.env.R2_BUCKET_NAME,
        },
        webhook: webhookUrl,
      }),
    }
  )

  if (!runpodRes.ok) {
    const err = await runpodRes.text()
    console.error('RunPod error:', err)
    return NextResponse.json({ error: 'No se pudo iniciar el procesamiento' }, { status: 502 })
  }

  const { id: runpodJobId } = await runpodRes.json()

  // Actualizar proyecto con job ID y estado
  await db.from('projects').update({
    status:                'processing',
    runpod_job_id:         runpodJobId,
    quality,
    video_r2_key:          videoKey,
    processing_started_at: new Date().toISOString(),
  }).eq('id', projectId)

  return NextResponse.json({ jobId: runpodJobId })
}
