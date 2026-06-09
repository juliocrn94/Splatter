import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, nextProjectCodeVersion } from "@/lib/supabase"
import { getPresignedUploadUrl, getPresignedDownloadUrl } from '@/lib/r2'
import { requireAuth } from '@/lib/auth'

const DISPATCHABLE_STATUSES = ['uploading', 'reviewing', 'failed']

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req)
  if (authError) return authError

  const { projectId, videoKey, videoKeys: rawVideoKeys, quality: rawQuality = 'standard' } = await req.json()

  // Normalizar: aceptar videoKey (string, backwards compat) o videoKeys (array, 2B multi-video)
  const videoKeys: string[] = rawVideoKeys
    ? (Array.isArray(rawVideoKeys) ? rawVideoKeys : [rawVideoKeys])
    : videoKey ? [videoKey] : []

  if (!projectId || videoKeys.length === 0) {
    return NextResponse.json({ error: 'projectId y videoKey(s) son requeridos' }, { status: 400 })
  }

  // Validar quality — solo valores conocidos
  const quality = rawQuality === 'hq' ? 'hq' : 'standard'

  // Validar que todos los keys tengan el prefijo esperado
  if (videoKeys.some(k => !String(k).startsWith('videos/'))) {
    return NextResponse.json({ error: 'videoKey inválido' }, { status: 400 })
  }

  // El primer key es el video principal (backwards compat con video_r2_key)
  const primaryVideoKey = videoKeys[0]

  const db = supabaseAdmin()

  const { data: project, error: fetchErr } = await db
    .from('projects')
    .select('id, status, video_r2_key, project_code, ply_r2_key')
    .eq('id', projectId)
    .single()

  if (fetchErr || !project) {
    console.error('[/api/jobs] Proyecto no encontrado:', { projectId, error: fetchErr?.message })
    return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  }

  // Guard: no despachar si ya hay un job activo
  if (!DISPATCHABLE_STATUSES.includes(project.status)) {
    return NextResponse.json(
      { error: `El proyecto ya está en estado "${project.status}" y no puede iniciar un nuevo job` },
      { status: 409 }
    )
  }

  // Pre-generar claves de salida y URLs firmadas para que RunPod suba los archivos sin credenciales
  const plyKey = `results/${projectId}.ply`
  const spzKey = `results/${projectId}.spz`
  const [plyUploadUrl, spzUploadUrl, ...videoDownloadUrls] = await Promise.all([
    getPresignedUploadUrl(plyKey, 'application/octet-stream'),
    getPresignedUploadUrl(spzKey, 'application/octet-stream'),
    ...videoKeys.map(k => getPresignedDownloadUrl(k)),
  ])
  // Primer video como video_url principal para compatibilidad con el worker actual
  const primaryVideoUrl = videoDownloadUrls[0]

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`

  const runpodRes = await fetch(
    `https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID}/run`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          project_id:     projectId,
          video_url:      primaryVideoUrl,
          video_urls:     videoDownloadUrls,  // array para multi-video (2B)
          quality,
          ply_upload_url: plyUploadUrl,
          spz_upload_url: spzUploadUrl,
        },
        webhook: webhookUrl,
      }),
    }
  )

  if (!runpodRes.ok) {
    const runpodError = await runpodRes.text().catch(() => 'sin respuesta')
    console.error('[/api/jobs] RunPod rechazó el job:', {
      projectId, quality, status: runpodRes.status,
      endpointId: process.env.RUNPOD_ENDPOINT_ID,
      response: runpodError,
    })
    return NextResponse.json({ error: 'No se pudo iniciar el procesamiento' }, { status: 502 })
  }

  const { id: runpodJobId } = await runpodRes.json()

  const hasPriorResult = !!project.ply_r2_key
  const isReprocess = project.status === "reviewing" || (hasPriorResult && project.status === "failed")
  const newStatus = isReprocess ? "reprocessing" : "processing"
  const codeUpdate = hasPriorResult && project.project_code
    ? { project_code: nextProjectCodeVersion(project.project_code) }
    : {}

  await db.from('projects').update({
    status:                newStatus,
    runpod_job_id:         runpodJobId,
    quality,
    video_r2_key:          primaryVideoKey,    // backwards compat
    video_r2_keys:         videoKeys,           // array completo (2B)
    ply_r2_key:            plyKey,
    spz_r2_key:            spzKey,
    processing_started_at: new Date().toISOString(),
    ...codeUpdate,
  }).eq('id', projectId)

  return NextResponse.json({ jobId: runpodJobId })
}
