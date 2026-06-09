import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Mensajes de error legibles para el operador
const ERROR_MESSAGES: Record<string, string> = {
  COLMAP_FAILED:   'No se pudo reconstruir la escena. Intenta grabar con mejor iluminación y movimiento más lento.',
  OOM:             'El video tiene demasiados detalles para el modo estándar. Usa modo alta calidad o graba en secciones.',
  TIMEOUT:         'El procesamiento tardó demasiado. Intenta con un video más corto (máx 5 minutos).',
  FFMPEG_FAILED:   'El archivo de video está dañado o en un formato no compatible.',
  DEFAULT:         'Ocurrió un error durante el procesamiento. Intenta de nuevo.',
}

function getErrorMessage(code?: string): string {
  if (!code) return ERROR_MESSAGES.DEFAULT
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.DEFAULT
}

export async function POST(req: NextRequest) {
  // Validar que el webhook viene de RunPod
  const secret = req.headers.get('x-runpod-secret')
  if (secret !== process.env.RUNPOD_WEBHOOK_SECRET) {
    console.warn('[/api/webhook] Webhook con secret inválido — posible intento externo')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { id: runpodJobId, status, output, error } = body

  console.log('[/api/webhook] Recibido:', { runpodJobId, status, hasOutput: !!output, error })

  if (!runpodJobId) {
    return NextResponse.json({ error: 'runpodJobId requerido' }, { status: 400 })
  }

  const db = supabaseAdmin()

  // Buscar proyecto por job ID — garantiza que este webhook es para el job activo
  const { data: project } = await db
    .from('projects')
    .select('id, status, runpod_job_id')
    .eq('runpod_job_id', runpodJobId)
    .single()

  if (!project) {
    // Job no encontrado o pertenece a un job anterior (stale webhook) — ignorar
    return NextResponse.json({ ok: true })
  }

  // Idempotencia: ignorar si el proyecto ya está en un estado terminal o en un nuevo job
  const TERMINAL_STATUSES = ['reviewing', 'reprocessing', 'delivered']
  if (TERMINAL_STATUSES.includes(project.status)) {
    return NextResponse.json({ ok: true })
  }

  if (status === 'COMPLETED') {
    console.log('[/api/webhook] Job completado — marcando proyecto como reviewing:', project.id)

    const { data: fullProject } = await db
      .from('projects')
      .select('processing_started_at, quality')
      .eq('id', project.id)
      .single()

    await db.from('projects').update({ status: 'reviewing' }).eq('id', project.id)

    // Insertar métricas para el estimador dinámico (2D) — fallo no bloquea el flujo
    try {
      const durationS = fullProject?.processing_started_at
        ? Math.round((Date.now() - new Date(fullProject.processing_started_at).getTime()) / 1000)
        : null

      await db.from('processing_metrics').insert({
        project_id:            project.id,
        processing_duration_s: durationS,
        quality:               fullProject?.quality ?? 'standard',
        // Los campos de tamaño vienen del output del worker cuando esté disponible
        frame_count:           output?.frame_count   ?? null,
        video_size_bytes:      output?.video_size_bytes ?? null,
        ply_size_bytes:        output?.ply_size_bytes ?? null,
        spz_size_bytes:        output?.spz_size_bytes ?? null,
      })
      console.log('[/api/webhook] Métricas guardadas:', { projectId: project.id, durationS })
    } catch (metricsErr) {
      console.error('[/api/webhook] Error al guardar métricas (no crítico):', metricsErr)
    }
  } else {
    console.error('[/api/webhook] Job fallido:', { projectId: project.id, error, runpodJobId })
    await db.from('projects').update({
      status:        'failed',
      error_message: getErrorMessage(error?.code),
    }).eq('id', project.id)
  }

  return NextResponse.json({ ok: true })
}
