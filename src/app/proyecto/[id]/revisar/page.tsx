'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { supabase, Project } from '@/lib/supabase'
import { getPublicUrl } from '@/lib/r2'

export default function RevisarPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [delivering, setDelivering] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [showHqConfirm, setShowHqConfirm] = useState(false)
  const [showCorrectModal, setShowCorrectModal] = useState(false)
  const [correctionFile, setCorrectionFile] = useState<File | null>(null)
  const [correctionProgress, setCorrectionProgress] = useState(0)
  const [correctionError, setCorrectionError] = useState('')
  const [inlineError, setInlineError] = useState('')

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
    setInlineError('')
    try {
      const res = await fetch(`/api/projects/${id}/deliver`, { method: 'POST' })
      if (!res.ok) throw new Error('Error al aprobar')
      router.push(`/proyecto/${id}/entrega`)
    } catch {
      setInlineError('No se pudo aprobar el proyecto. Intenta de nuevo.')
      setDelivering(false)
    }
  }

  async function handleReprocess() {
    if (!project) return
    setReprocessing(true)
    setShowHqConfirm(false)
    setInlineError('')
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, videoKeys: project.video_r2_keys?.length
          ? project.video_r2_keys
          : [project.video_r2_key], quality: 'hq' }),
      })
      if (!res.ok) throw new Error('Error al iniciar reproceso')
      router.push(`/proyecto/${id}`)
    } catch {
      setInlineError('No se pudo iniciar el reproceso. Intenta de nuevo.')
      setReprocessing(false)
    }
  }

  // 2C — Corrección post-QC: sube video adicional y relanza el job
  async function handleCorrection() {
    if (!project || !correctionFile) return
    setReprocessing(true)
    setCorrectionError('')

    try {
      // 1. Subir video de corrección a R2
      const presignRes = await fetch('/api/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: correctionFile.name, contentType: correctionFile.type, sizeBytes: correctionFile.size }),
      })
      if (!presignRes.ok) throw new Error('No se pudo generar URL de subida')
      const { url, key } = await presignRes.json()

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', (ev) => {
          if (ev.lengthComputable) setCorrectionProgress(Math.round((ev.loaded / ev.total) * 100))
        })
        xhr.open('PUT', url)
        xhr.setRequestHeader('Content-Type', correctionFile.type)
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error('Error al subir'))
        xhr.onerror = () => reject(new Error('Error de red'))
        xhr.send(correctionFile)
      })

      // 2. Combinar con los videos originales y relanzar
      const existingKeys: string[] = project.video_r2_keys?.length
        ? project.video_r2_keys as string[]
        : project.video_r2_key ? [project.video_r2_key] : []

      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          videoKeys: [...existingKeys, key],
          quality: 'standard',
        }),
      })
      if (!jobRes.ok) throw new Error('No se pudo iniciar el reproceso de corrección')

      setShowCorrectModal(false)
      router.push(`/proyecto/${id}`)
    } catch (err) {
      setCorrectionError(err instanceof Error ? err.message : 'Error desconocido')
      setReprocessing(false)
    }
  }

  const { getRootProps, getInputProps } = useDropzone({
    onDrop: (files) => { if (files[0]) { setCorrectionFile(files[0]); setCorrectionError('') } },
    accept: { 'video/*': [] },
    maxFiles: 1,
  })

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
          {project.project_code && (
            <button
              onClick={() => navigator.clipboard.writeText(project.project_code!)}
              className="inline-block mt-1 text-xs font-mono bg-gray-800 text-violet-300 px-2 py-0.5 rounded hover:bg-gray-700 cursor-pointer"
              title="Copiar código"
            >
              {project.project_code}
            </button>
          )}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={() => setShowCorrectModal(true)}
            disabled={reprocessing}
            className="text-sm text-gray-500 hover:text-gray-300 px-3 py-2 rounded-lg transition-colors"
          >
            Mejorar zona
          </button>
          <button
            onClick={() => setShowHqConfirm(true)}
            disabled={reprocessing}
            className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-4 py-2 rounded-lg transition-colors"
          >
            Reprocesar en alta calidad
          </button>
          <button
            onClick={handleDeliver}
            disabled={delivering || reprocessing}
            className="bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            {delivering ? 'Generando link...' : 'Aprobar y generar link'}
          </button>
        </div>
      </div>

      {inlineError && (
        <div className="px-6 py-2 bg-red-950/40 border-b border-red-800 text-red-400 text-sm">{inlineError}</div>
      )}

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

      {/* Sticky bottom bar — mobile */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-950/95 backdrop-blur border-t border-gray-800 px-4 py-3 flex gap-2 md:hidden z-40">
        <button
          onClick={() => setShowCorrectModal(true)}
          disabled={reprocessing}
          className="text-sm text-gray-500 border border-gray-800 px-3 py-2.5 rounded-lg transition-colors"
        >
          Mejorar
        </button>
        <button
          onClick={() => setShowHqConfirm(true)}
          disabled={reprocessing}
          className="flex-1 text-sm text-gray-400 border border-gray-700 px-3 py-2.5 rounded-lg transition-colors"
        >
          Reprocesar
        </button>
        <button
          onClick={handleDeliver}
          disabled={delivering || reprocessing}
          className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors"
        >
          {delivering ? 'Generando...' : 'Aprobar'}
        </button>
      </div>

      {/* Modal HQ */}
      {showHqConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-lg mb-2">Reprocesar en alta calidad</h2>
            <p className="text-gray-400 text-sm mb-2">Procesará el video completo con todas las imágenes disponibles.</p>
            <div className="bg-gray-800 rounded-lg px-4 py-3 mb-4 text-sm">
              <div className="flex justify-between text-gray-300">
                <span>Tiempo estimado</span><span className="font-medium">~45 min</span>
              </div>
              <div className="flex justify-between text-gray-300 mt-1">
                <span>Costo adicional</span><span className="font-medium">~$0.50 USD</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowHqConfirm(false)} className="flex-1 border border-gray-700 text-gray-400 py-2.5 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleReprocess} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 rounded-lg text-sm font-medium">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal corrección post-QC (2C) */}
      {showCorrectModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h2 className="font-semibold text-lg">Mejorar zona específica</h2>
            <p className="text-gray-400 text-sm">
              Graba un video adicional enfocado en la zona que quieres mejorar.
              El sistema lo combinará con la captura original y procesará de nuevo.
            </p>
            <div className="bg-blue-950/30 border border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-300">
              <strong>Importante:</strong> el nuevo video debe iniciar y terminar en zonas que ya aparecen en el tour actual, para que COLMAP pueda alinearlos.
            </div>

            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                correctionFile ? 'border-green-600 bg-green-950/20' : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <input {...getInputProps()} />
              {correctionFile ? (
                <div>
                  <p className="text-green-400 font-medium text-sm truncate">{correctionFile.name}</p>
                  <p className="text-gray-500 text-xs mt-1">{(correctionFile.size / (1024 ** 3)).toFixed(2)} GB</p>
                </div>
              ) : (
                <p className="text-gray-400 text-sm">Arrastra el video de corrección</p>
              )}
            </div>

            {correctionProgress > 0 && correctionProgress < 100 && (
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Subiendo...</span><span>{correctionProgress}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div className="bg-violet-500 h-1.5 rounded-full transition-all" style={{ width: `${correctionProgress}%` }} />
                </div>
              </div>
            )}

            {correctionError && <p className="text-red-400 text-sm">{correctionError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setShowCorrectModal(false); setCorrectionFile(null); setCorrectionProgress(0); setCorrectionError('') }}
                className="flex-1 border border-gray-700 text-gray-400 py-2.5 rounded-lg text-sm"
                disabled={reprocessing}
              >
                Cancelar
              </button>
              <button
                onClick={handleCorrection}
                disabled={!correctionFile || reprocessing}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white py-2.5 rounded-lg text-sm font-medium"
              >
                {reprocessing ? 'Procesando...' : 'Mejorar tour'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
