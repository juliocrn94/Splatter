'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Project, STATUS_LABELS } from '@/lib/supabase'

const STAGES = [
  { key: 'uploading',   label: 'Subiendo video' },
  { key: 'processing',  label: 'Procesando' },
  { key: 'reviewing',   label: 'Listo para revisar' },
  { key: 'delivered',   label: 'Entregado' },
]

const PROCESSING_TIPS = [
  'Iniciando instancia GPU... (puede tardar 1–3 min)',
  'Extrayendo frames del video...',
  'Analizando posiciones de cámara (COLMAP)...',
  'Entrenando el tour 3D (OpenSplat)...',
  'Guardando archivos...',
]

export default function ProyectoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [tipIdx, setTipIdx] = useState(0)

  useEffect(() => {
    supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => setProject(data))

    // Realtime — redirige cuando el estado cambia
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

    // Rotar tips de procesamiento cada 18 segundos
    const timer = setInterval(() => setTipIdx((i) => (i + 1) % PROCESSING_TIPS.length), 18000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
    }
  }, [id, router])

  async function handleRetry() {
    if (!project) return
    try {
      const res = await fetch(`/api/projects/${id}/retry`, { method: 'POST' })
      if (!res.ok) throw new Error('Error al reintentar')
      router.push(`/nuevo?retry=${id}`)
    } catch {
      alert('No se pudo reiniciar el proyecto. Intenta de nuevo.')
    }
  }

  if (!project) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Cargando...</div>
  }

  const stageIdx = STAGES.findIndex((s) => s.key === project.status)

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-lg mx-auto">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Proyectos</a>

        <div className="mt-8 mb-10">
          <h1 className="text-xl font-bold">{project.name}</h1>
          <p className="text-gray-400 text-sm mt-1">{project.client_name}</p>
        </div>

        {/* Stepper */}
        <div className="space-y-4 mb-10">
          {STAGES.map((stage, i) => {
            const done    = i < stageIdx
            const current = i === stageIdx
            const pending = i > stageIdx

            return (
              <div key={stage.key} className="flex items-center gap-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  done    ? 'bg-green-600 text-white' :
                  current ? 'bg-violet-600 text-white animate-pulse' :
                            'bg-gray-800 text-gray-600'
                }`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className={pending ? 'text-gray-600' : current ? 'text-white font-medium' : 'text-gray-300'}>
                  {stage.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Estado procesando */}
        {project.status === 'processing' && (
          <div className="bg-gray-900 rounded-xl p-5 text-sm text-gray-400 border border-gray-800">
            <p className="text-violet-300 font-medium mb-1">⏳ Procesando tu tour 3D</p>
            <p>{PROCESSING_TIPS[tipIdx]}</p>
            <p className="text-gray-600 mt-3">Tiempo estimado: 20–25 minutos</p>
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
              Reintentar con nuevo video
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
