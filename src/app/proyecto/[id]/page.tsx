'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Project } from '@/lib/supabase'

// Carga el promedio de duración de los últimos 5 proyectos estándar
async function fetchEstimatedMinutes(): Promise<number | null> {
  const { data } = await supabase
    .from('processing_metrics' as string)
    .select('processing_duration_s')
    .eq('quality', 'standard')
    .not('processing_duration_s', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5) as { data: { processing_duration_s: number }[] | null }
  if (!data || data.length === 0) return null
  const avg = data.reduce((sum, r) => sum + r.processing_duration_s, 0) / data.length
  return Math.round(avg / 60)
}

const STAGES = [
  { key: 'uploading',   label: 'Subiendo video',      estMin: 2  },
  { key: 'processing',  label: 'Procesando tour 3D',  estMin: 22 },
  { key: 'reviewing',   label: 'Listo para revisar',  estMin: 0  },
  { key: 'delivered',   label: 'Entregado',            estMin: 0  },
]

const PROCESSING_STEPS = [
  { label: 'Iniciando instancia GPU',    pct: 10, duration: 180  },
  { label: 'Extrayendo frames del video', pct: 25, duration: 120  },
  { label: 'Analizando posiciones de cámara (COLMAP)', pct: 55, duration: 360 },
  { label: 'Entrenando el tour 3D (OpenSplat)', pct: 85, duration: 600 },
  { label: 'Guardando y optimizando archivos', pct: 95, duration: 120 },
]

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function useElapsed(startedAt: string | null): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const update = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [startedAt])
  return elapsed
}

function ProcessingProgress({ startedAt, estimatedMin }: { startedAt: string | null; estimatedMin: number | null }) {
  const elapsed = useElapsed(startedAt)
  const staticTotal = PROCESSING_STEPS.reduce((a, s) => a + s.duration, 0)
  const totalSec = estimatedMin ? estimatedMin * 60 : staticTotal
  const remaining = Math.max(0, totalSec - elapsed)

  // Calcular en qué step estamos
  let cumulative = 0
  let currentStep = 0
  for (let i = 0; i < PROCESSING_STEPS.length; i++) {
    if (elapsed >= cumulative + PROCESSING_STEPS[i].duration) {
      cumulative += PROCESSING_STEPS[i].duration
      currentStep = i + 1
    } else {
      break
    }
  }
  currentStep = Math.min(currentStep, PROCESSING_STEPS.length - 1)

  // Progreso suavizado dentro del step actual
  const stepElapsed = elapsed - cumulative
  const stepDur = PROCESSING_STEPS[currentStep]?.duration ?? 1
  const stepPctStart = currentStep === 0 ? 0 : PROCESSING_STEPS[currentStep - 1].pct
  const stepPctEnd = PROCESSING_STEPS[currentStep]?.pct ?? 100
  const withinStep = Math.min(stepElapsed / stepDur, 1)
  const pct = Math.min(Math.round(stepPctStart + (stepPctEnd - stepPctStart) * withinStep), 99)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex justify-between text-sm">
        <span className="text-violet-300 font-medium">
          {PROCESSING_STEPS[currentStep]?.label ?? 'Procesando...'}
        </span>
        <span className="text-gray-500">{pct}%</span>
      </div>

      {/* Barra principal */}
      <div className="w-full bg-gray-800 rounded-full h-2.5">
        <div
          className="bg-violet-500 h-2.5 rounded-full transition-all duration-1000"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps individuales */}
      <div className="space-y-1.5 pt-1">
        {PROCESSING_STEPS.map((step, i) => {
          const done    = i < currentStep
          const current = i === currentStep
          const pending = i > currentStep
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                done    ? 'bg-green-700 text-white' :
                current ? 'bg-violet-600 text-white' :
                          'bg-gray-800 text-gray-600'
              }`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={pending ? 'text-gray-600' : current ? 'text-gray-300' : 'text-gray-500'}>
                {step.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Tiempo */}
      <div className="flex justify-between text-xs text-gray-600 pt-1 border-t border-gray-800">
        <span>Transcurrido: {formatTime(elapsed)}</span>
        <span>Estimado restante: ~{formatTime(remaining)}</span>
      </div>
    </div>
  )
}

export default function ProyectoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [estimatedMin, setEstimatedMin] = useState<number | null>(null)

  useEffect(() => {
    fetchEstimatedMinutes().then(setEstimatedMin)
  }, [])

  useEffect(() => {
    supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => setProject(data))

    const channel = supabase
      .channel(`project-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'projects',
        filter: `id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as Project
        setProject(updated)
        if (updated.status === 'reviewing') router.push(`/proyecto/${id}/revisar`)
        if (updated.status === 'delivered')  router.push(`/proyecto/${id}/entrega`)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id, router])

  async function handleRetry() {
    if (!project) return
    try {
      const res = await fetch(`/api/projects/${id}/retry`, { method: 'POST' })
      if (!res.ok) throw new Error('Error al reintentar')
      const { reused } = await res.json()
      // Si el video ya estaba en R2, se re-despachó directo — quedarse en esta página
      if (!reused) router.push('/nuevo')
    } catch {
      alert('No se pudo reiniciar el proyecto.')
    }
  }

  if (!project) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Cargando...</div>
  }

  const stageIdx = STAGES.findIndex((s) => s.key === project.status)
  const currentStage = STAGES[stageIdx]

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-lg mx-auto">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Proyectos</a>

        <div className="mt-8 mb-8">
          <h1 className="text-xl font-bold">{project.name}</h1>
          <p className="text-gray-400 text-sm mt-1">{project.client_name}</p>
          {project.project_code && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(project.project_code!)
                setCodeCopied(true)
                setTimeout(() => setCodeCopied(false), 2000)
              }}
              className="inline-block mt-2 text-xs font-mono bg-gray-800 text-violet-300 px-2 py-1 rounded hover:bg-gray-700 cursor-pointer"
              title="Copiar código"
            >
              {codeCopied ? '¡Copiado!' : project.project_code}
            </button>
          )}
        </div>

        {/* Stepper */}
        <div className="space-y-3 mb-8">
          {STAGES.map((stage, i) => {
            const done    = i < stageIdx
            const current = i === stageIdx
            const pending = i > stageIdx

            return (
              <div key={stage.key} className="flex items-center gap-4">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  done    ? 'bg-green-600 text-white' :
                  current ? 'bg-violet-600 text-white animate-pulse' :
                            'bg-gray-800 text-gray-600'
                }`}>
                  {done ? '✓' : i + 1}
                </div>
                <div className="flex-1">
                  <span className={pending ? 'text-gray-600' : current ? 'text-white font-medium' : 'text-gray-400'}>
                    {stage.label}
                  </span>
                  {current && stage.key === 'processing' && (
                    <span className="ml-2 text-xs text-gray-600">
                      {estimatedMin
                        ? `~${estimatedMin} min (basado en proyectos anteriores)`
                        : `~${stage.estMin} min`}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Progreso detallado cuando está procesando */}
        {project.status === 'processing' && (
          <>
            <ProcessingProgress startedAt={project.processing_started_at} estimatedMin={estimatedMin} />
            <div className="mt-4 bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-sm">
              <p className="text-gray-400">✓ Puedes cerrar esta página. El procesamiento continúa en segundo plano.</p>
              <div className="flex gap-3 mt-3">
                <a href="/" className="text-violet-400 hover:text-violet-300 text-sm">← Volver al dashboard</a>
                <a href="/nuevo" className="text-violet-400 hover:text-violet-300 text-sm">+ Subir otro proyecto</a>
              </div>
            </div>
          </>
        )}

        {/* Estado uploading */}
        {project.status === 'uploading' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-400">
            <p className="text-blue-300 font-medium mb-1">⬆️ Subiendo video a la nube...</p>
            <p className="text-gray-600 text-xs mt-2">El procesamiento comenzará automáticamente al terminar</p>
          </div>
        )}

        {/* Estado error */}
        {project.status === 'failed' && (
          <div className="bg-red-950/30 border border-red-800 rounded-xl p-5">
            <p className="text-red-400 font-medium mb-2">El procesamiento falló</p>
            <p className="text-red-200/70 text-sm">{project.error_message}</p>
            <button
              onClick={handleRetry}
              className="mt-4 bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {project.video_r2_key ? 'Reintentar' : 'Subir nuevo video'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
