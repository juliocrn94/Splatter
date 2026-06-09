import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPresignedUploadUrl, getPresignedDownloadUrl } from '@/lib/r2'
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
    .select('id, status, video_r2_key, video_r2_keys, quality')
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

  // Si el video ya está en R2, re-despachar directamente sin pedir re-upload
  const primaryVideoKey = (project.video_r2_keys as string[] | null)?.[0] ?? project.video_r2_key
  if (primaryVideoKey) {
    const projectId = id
    const quality   = project.quality ?? 'standard'
    const videoKeys: string[] = (project.video_r2_keys as string[] | null)?.length
      ? (project.video_r2_keys as string[])
      : [primaryVideoKey]

    const plyKey = `results/${projectId}.ply`
    const spzKey = `results/${projectId}.spz`

    const [plyUploadUrl, spzUploadUrl, ...videoDownloadUrls] = await Promise.all([
      getPresignedUploadUrl(plyKey, 'application/octet-stream'),
      getPresignedUploadUrl(spzKey, 'application/octet-stream'),
      ...videoKeys.map(k => getPresignedDownloadUrl(k)),
    ])

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
            video_url:      videoDownloadUrls[0],
            video_urls:     videoDownloadUrls,
            quality,
            ply_upload_url: plyUploadUrl,
            spz_upload_url: spzUploadUrl,
          },
          webhook: webhookUrl,
        }),
      }
    )

    if (!runpodRes.ok) {
      return NextResponse.json({ error: 'No se pudo re-despachar el job' }, { status: 502 })
    }

    const { id: runpodJobId } = await runpodRes.json()

    await db.from('projects').update({
      status:                'processing',
      error_message:         null,
      runpod_job_id:         runpodJobId,
      ply_r2_key:            plyKey,
      spz_r2_key:            spzKey,
      processing_started_at: new Date().toISOString(),
    }).eq('id', projectId)

    return NextResponse.json({ ok: true, reused: true })
  }

  // Sin video en R2 — resetear a uploading para que el operador suba uno nuevo
  await db
    .from('projects')
    .update({ status: 'uploading', error_message: null })
    .eq('id', id)

  return NextResponse.json({ ok: true, reused: false })
}
