'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Project } from '@/lib/supabase'
import { getPublicUrl } from '@/lib/r2'

export default function RevisarPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [delivering, setDelivering] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [showHqConfirm, setShowHqConfirm] = useState(false)

  useEffect(() => {
    supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => setProject(data))
  }, [id])

  async function handleDeliver() {
    if (!project) return
    setDelivering(true)
    try {
      const res = await fetch(`/api/projects/${id}/deliver`, { method: 'POST' })
      if (!res.ok) throw new Error('Error al aprobar')
      router.push(`/proyecto/${id}/entrega`)
    } catch {
      setDelivering(false)
      alert('No se pudo aprobar el proyecto. Intenta de nuevo.')
    }
  }

  async function handleReprocess() {
    if (!project) return
    setReprocessing(true)
    setShowHqConfirm(false)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          videoKey:  project.video_r2_key,
          quality:   'hq',
        }),
      })
      if (!res.ok) throw new Error('Error al iniciar reproceso')
      router.push(`/proyecto/${id}`)
    } catch {
      setReprocessing(false)
      alert('No se pudo iniciar el reproceso. Intenta de nuevo.')
    }
  }

  if (!project) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Cargando...</div>
  }

  const spzUrl = project.spz_r2_key ? getPublicUrl(project.spz_r2_key) : null

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/90 backdrop-blur">
        <div>
          <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Proyectos</a>
          <h1 className="font-semibold mt-0.5">{project.name}</h1>
          <p className="text-gray-500 text-sm">{project.client_name}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHqConfirm(true)}
            disabled={reprocessing}
            className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-4 py-2 rounded-lg transition-colors"
          >
            Reprocesar en alta calidad
          </button>
          <button
            onClick={handleDeliver}
            disabled={delivering}
            className="bg-violet-600 hover:bg-violet-500 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            {delivering ? 'Generando link...' : 'Aprobar y generar link'}
          </button>
        </div>
      </div>

      {/* Viewer */}
      <div className="flex-1 relative">
        {spzUrl ? (
          <iframe
            src={`/viewer?spz=${encodeURIComponent(spzUrl)}`}
            className="w-full h-full border-0"
            title="Tour 3D"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600">
            Archivo del tour no disponible
          </div>
        )}
      </div>

      {/* Modal confirmación alta calidad */}
      {showHqConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-lg mb-2">Reprocesar en alta calidad</h2>
            <p className="text-gray-400 text-sm mb-2">
              Procesará el video completo con todas las imágenes disponibles.
            </p>
            <div className="bg-gray-800 rounded-lg px-4 py-3 mb-4 text-sm">
              <div className="flex justify-between text-gray-300">
                <span>Tiempo estimado</span>
                <span className="font-medium">~45 min</span>
              </div>
              <div className="flex justify-between text-gray-300 mt-1">
                <span>Costo adicional</span>
                <span className="font-medium">~$0.50 USD</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowHqConfirm(false)}
                className="flex-1 border border-gray-700 text-gray-400 py-2.5 rounded-lg text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleReprocess}
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 rounded-lg text-sm font-medium"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
