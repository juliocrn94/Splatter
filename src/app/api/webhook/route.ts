import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Mensajes de error legibles para el operador
const ERROR_MESSAGES: Record<string, string> = {
  COLMAP_FAILED:     'No se pudo reconstruir la escena. Intenta grabar con mejor iluminación y movimiento más lento.',
  OOM:               'El video tiene demasiados detalles para el modo estándar. Usa modo alta calidad o graba en secciones.',
  TIMEOUT:           'El procesamiento tardó demasiado. Intenta con un video más corto (máx 5 minutos).',
  FFMPEG_FAILED:     'El archivo de video está dañado o en un formato no compatible.',
  OPENSPLAT_FAILED:  'El entrenamiento del splat falló. Intenta reprocesar en alta calidad.',
  PIPELINE_FAILED:   'Error interno del pipeline. El equipo fue notificado.',
  DEFAULT:           'Ocurrió un error durante el procesamiento. Intenta de nuevo.',
}

function getErrorMessage(code?: string): string {
  if (!code) return ERROR_MESSAGES.DEFAULT
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.DEFAULT
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-runpod-secret')
  const expectedSecret = process.env.RUNPOD_WEBHOOK_SECRET

  if (expectedSecret) {
    // Secret configurado: rechazar cualquier request que no lo traiga o no coincida
    if (secret !== expectedSecret) {
      console.warn('[/api/webhook] Secret inválido o ausente — rechazando')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    // Sin secret: loguear advertencia pero seguir (no bloquear durante desarrollo)
    console.warn('[/api/webhook] RUNPOD_WEBHOOK_SECRET no configurado — validando solo por job_id')
  }
  console.log('[/api/webhook] Auth:', secret ? 'secret OK' : 'sin secret')

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

  // Idempotencia: ignorar solo si el proyecto YA terminó un job.
  // 'processing' y 'reprocessing' son estados ACTIVOS (job en curso) — el webhook
  // DEBE poder sacarlos de ahí. Incluir 'reprocessing' aquí causaba que los
  // reprocesos completaran en RunPod pero nunca pasaran a 'reviewing'.
  const TERMINAL_STATUSES = ['reviewing', 'delivered']
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
    // RunPod envía `error` como string cuando el handler lanza una excepción.
    // El formato es "CODIGO: mensaje" — extraemos el código del prefijo.
    const errorStr  = typeof error === 'string' ? error : (error as Record<string, unknown>)?.code as string
    const errorCode = errorStr ? errorStr.split(':')[0]?.trim() : undefined
    console.error('[/api/webhook] Job fallido:', { projectId: project.id, error, errorCode, runpodJobId })
    await db.from('projects').update({
      status:        'failed',
      error_message: getErrorMessage(errorCode),
    }).eq('id', project.id)
  }

  return NextResponse.json({ ok: true })
}
