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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { id: runpodJobId, status, output, error } = body

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
    // Las claves de salida ya fueron guardadas al despachar el job — solo actualizar status
    await db.from('projects').update({
      status: 'reviewing',
    }).eq('id', project.id)
  } else {
    await db.from('projects').update({
      status:        'failed',
      error_message: getErrorMessage(error?.code),
    }).eq('id', project.id)
  }

  return NextResponse.json({ ok: true })
}
