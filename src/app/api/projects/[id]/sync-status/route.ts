import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

const ERROR_MESSAGES: Record<string, string> = {
  COLMAP_FAILED:    'No se pudo reconstruir la escena. Intenta grabar con mejor iluminación y movimiento más lento.',
  OOM:              'El video tiene demasiados detalles para el modo estándar. Usa modo alta calidad o graba en secciones.',
  TIMEOUT:          'El procesamiento tardó demasiado. Intenta con un video más corto (máx 5 minutos).',
  FFMPEG_FAILED:    'El archivo de video está dañado o en un formato no compatible.',
  PIPELINE_FAILED:  'El procesamiento falló. Revisa que el video sea de buena calidad e inténtalo de nuevo.',
  DEFAULT:          'Ocurrió un error durante el procesamiento. Intenta de nuevo.',
}

function getErrorMessage(code?: string): string {
  if (!code) return ERROR_MESSAGES.DEFAULT
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.DEFAULT
}

// Consulta el estado actual del job en RunPod directamente
async function fetchRunpodJobStatus(jobId: string): Promise<{ status: string; output?: unknown; error?: string } | null> {
  const apiKey     = process.env.RUNPOD_API_KEY
  const endpointId = process.env.RUNPOD_ENDPOINT_ID
  if (!apiKey || !endpointId) return null

  try {
    const res = await fetch(
      `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    )
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// POST /api/projects/[id]/sync-status
// Consulta RunPod para ver si el job completó pero el webhook no llegó.
// Si confirmado, actualiza el estado en Supabase.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAuth(req)
  if (authError) return authError

  const { id } = await params
  const db = supabaseAdmin()

  const { data: project, error: fetchErr } = await db
    .from('projects')
    .select('id, status, runpod_job_id')
    .eq('id', id)
    .single()

  if (fetchErr || !project) {
    return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  }

  const STUCK_STATUSES = ['processing', 'reprocessing']
  if (!STUCK_STATUSES.includes(project.status)) {
    return NextResponse.json({ synced: false, reason: 'El proyecto no está en estado processing/reprocessing', status: project.status })
  }

  if (!project.runpod_job_id) {
    return NextResponse.json({ synced: false, reason: 'No hay runpod_job_id registrado' })
  }

  const jobStatus = await fetchRunpodJobStatus(project.runpod_job_id)
  if (!jobStatus) {
    return NextResponse.json({ synced: false, reason: 'No se pudo consultar RunPod API' })
  }

  console.log('[sync-status]', { projectId: id, runpodJobId: project.runpod_job_id, jobStatus })

  if (jobStatus.status === 'COMPLETED') {
    await db.from('projects').update({ status: 'reviewing' }).eq('id', id)
    return NextResponse.json({ synced: true, action: 'marked_reviewing', runpodStatus: jobStatus.status })
  }

  if (jobStatus.status === 'FAILED') {
    const errorStr = typeof jobStatus.error === 'string' ? jobStatus.error : ''
    const errorCode = errorStr.split(':')[0]?.trim()
    await db.from('projects').update({
      status:        'failed',
      error_message: getErrorMessage(errorCode),
    }).eq('id', id)
    return NextResponse.json({ synced: true, action: 'marked_failed', runpodStatus: jobStatus.status, errorCode })
  }

  // IN_QUEUE, IN_PROGRESS — job sigue corriendo
  return NextResponse.json({ synced: false, reason: 'El job aún está en progreso', runpodStatus: jobStatus.status })
}
