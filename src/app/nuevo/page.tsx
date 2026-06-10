'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { getUploadWarning } from '@/lib/r2'
import { useVideoUpload } from '@/hooks/useVideoUpload'
import { type FeatureExtractor, type Trainer } from '@/lib/supabase'

const CIUDADES = [
  { code: 'CDMX', label: 'Ciudad de México' },
  { code: 'GDL',  label: 'Guadalajara' },
  { code: 'MTY',  label: 'Monterrey' },
  { code: 'PUE',  label: 'Puebla' },
  { code: 'QRO',  label: 'Querétaro' },
  { code: 'CUN',  label: 'Cancún' },
  { code: 'MID',  label: 'Mérida' },
  { code: 'TIJ',  label: 'Tijuana' },
  { code: 'SLP',  label: 'San Luis Potosí' },
  { code: 'OTR',  label: 'Otra ciudad' },
]

const MAX_ADDITIONAL_VIDEOS = 3

function VideoDropzone({
  label,
  hint,
  file,
  onFile,
  disabled,
}: {
  label: string
  hint?: string
  file: File | null
  onFile: (f: File) => void
  disabled?: boolean
}) {
  const onDrop = useCallback((accepted: File[]) => { if (accepted[0]) onFile(accepted[0]) }, [onFile])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    maxFiles: 1,
    disabled,
  })

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-2">{label}</label>
      {hint && <p className="text-xs text-gray-600 mb-2">{hint}</p>}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          disabled    ? 'border-gray-800 opacity-40 cursor-not-allowed' :
          isDragActive ? 'border-violet-500 bg-violet-950/20' :
          file         ? 'border-green-600 bg-green-950/20' :
                         'border-gray-700 hover:border-gray-600'
        }`}
      >
        <input {...getInputProps()} />
        {file ? (
          <div>
            <p className="text-green-400 font-medium text-sm truncate">{file.name}</p>
            <p className="text-gray-500 text-xs mt-1">{(file.size / (1024 ** 3)).toFixed(2)} GB</p>
          </div>
        ) : (
          <div>
            <p className="text-gray-400 text-sm">Arrastra el video aquí</p>
            <p className="text-gray-600 text-xs mt-1">MP4, MOV, AVI · Máx 4 GB</p>
          </div>
        )}
      </div>
    </div>
  )
}

function UploadBar({ label, progress, error }: { label: string; progress: number; error: string }) {
  if (error) return <p className="text-red-400 text-xs">{label}: {error}</p>
  if (progress === 0) return null
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span>{progress}%</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-1.5">
        <div className="bg-violet-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

export default function NuevoPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [city, setCity] = useState('CDMX')

  // Video principal
  const [mainFile, setMainFile] = useState<File | null>(null)
  const [mainWarning, setMainWarning] = useState<ReturnType<typeof getUploadWarning> | null>(null)

  // Videos adicionales (2B) — máximo 3
  const [additionalFiles, setAdditionalFiles] = useState<(File | null)[]>([null, null, null])
  const [showOverlapTip, setShowOverlapTip] = useState(false)

  const mainUpload = useVideoUpload()
  const additionalUploads = [useVideoUpload(), useVideoUpload(), useVideoUpload()]

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Pipeline config — lee defaults de localStorage (configurables en /ajustes)
  const [featureExtractor, setFeatureExtractor] = useState<FeatureExtractor>(() => {
    if (typeof window === 'undefined') return 'sift'
    return (localStorage.getItem('default_feature_extractor') as FeatureExtractor) ?? 'sift'
  })
  const [trainer, setTrainer] = useState<Trainer>(() => {
    if (typeof window === 'undefined') return 'opensplat'
    return (localStorage.getItem('default_trainer') as Trainer) ?? 'opensplat'
  })
  const [showPipelineConfig, setShowPipelineConfig] = useState(false)

  function handleMainFile(f: File) {
    setMainFile(f)
    setMainWarning(getUploadWarning(f.size))
    setError('')
  }

  function handleAdditionalFile(index: number, f: File) {
    setAdditionalFiles(prev => prev.map((existing, i) => i === index ? f : existing))
    if (index === 0) setShowOverlapTip(true)
    setError('')
  }

  const uploadingAny = mainUpload.uploading || additionalUploads.some(u => u.uploading)
  const activeAdditionals = additionalFiles.filter(Boolean).length

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!mainFile || !name || !clientName) return
    if (mainWarning?.blocked) return

    setSubmitting(true)
    setError('')

    try {
      // 1. Crear proyecto (con pipeline config del form)
      const createRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, clientName, city, feature_extractor: featureExtractor, trainer }),
      })
      if (!createRes.ok) throw new Error('No se pudo crear el proyecto')
      const { project } = await createRes.json()
      if (!project) throw new Error('No se pudo crear el proyecto')

      // 2. Subir video principal
      const { key: mainKey } = await mainUpload.upload(mainFile)

      // 3. Subir videos adicionales en paralelo
      const additionalToUpload = additionalFiles
        .map((f, i) => f ? { file: f, uploader: additionalUploads[i] } : null)
        .filter((x): x is { file: File; uploader: ReturnType<typeof useVideoUpload> } => x !== null)

      const additionalKeys = await Promise.all(
        additionalToUpload.map(({ file, uploader }) => uploader.upload(file).then(r => r.key))
      )

      const allVideoKeys = [mainKey, ...additionalKeys]

      // 4. Disparar pipeline
      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, videoKeys: allVideoKeys }),
      })
      if (!jobRes.ok) throw new Error('No se pudo iniciar el procesamiento')

      router.push(`/proyecto/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-xl mx-auto">
        <div className="mb-8">
          <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Proyectos</a>
          <h1 className="text-2xl font-bold mt-4">Nuevo proyecto</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Nombre del proyecto</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Torre Reforma Piso 12"
              required
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Desarrolladora / cliente</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Desarrollos Polanco S.A."
              required
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Ciudad</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500"
            >
              {CIUDADES.map((c) => (
                <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
              ))}
            </select>
            <p className="text-xs text-gray-600 mt-1">
              Código del proyecto: SPL-{city}-00001-A
            </p>
          </div>

          {/* Video principal */}
          <VideoDropzone
            label="Video principal"
            file={mainFile}
            onFile={handleMainFile}
            disabled={uploadingAny}
          />

          {mainWarning?.warning && (
            <div className="bg-amber-950/40 border border-amber-700 rounded-lg p-4">
              <p className="text-amber-400 font-medium text-sm">⚠️ Video grande detectado</p>
              <p className="text-amber-200/70 text-sm mt-1">
                Tardará aprox. <strong>{mainWarning.estimatedMinutes} min</strong> y costará{' '}
                <strong>${mainWarning.estimatedCostUSD} USD</strong> en GPU.
              </p>
            </div>
          )}

          {mainWarning?.blocked && (
            <div className="bg-red-950/40 border border-red-700 rounded-lg p-4">
              <p className="text-red-400 font-medium text-sm">Video demasiado grande</p>
              <p className="text-red-200/70 text-sm mt-1">Máximo 4 GB por video.</p>
            </div>
          )}

          {/* Videos adicionales (2B) */}
          {mainFile && !mainWarning?.blocked && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-400">Videos adicionales <span className="text-gray-600">(opcional)</span></label>
                <span className="text-xs text-gray-600">{activeAdditionals}/{MAX_ADDITIONAL_VIDEOS}</span>
              </div>

              {showOverlapTip && (
                <div className="bg-blue-950/30 border border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-300">
                  <strong>Overlap requerido:</strong> cada video adicional debe compartir al menos 30 segundos de perspectiva con el video anterior — COLMAP necesita puntos en común para alinear las cámaras.
                </div>
              )}

              {Array.from({ length: MAX_ADDITIONAL_VIDEOS }).map((_, i) => (
                <VideoDropzone
                  key={i}
                  label={`Video adicional ${i + 1}`}
                  hint={i === 0 ? 'Agrega perspectivas de dron, ángulos específicos o zonas de detalle' : undefined}
                  file={additionalFiles[i]}
                  onFile={(f) => handleAdditionalFile(i, f)}
                  disabled={uploadingAny || (i > 0 && !additionalFiles[i - 1])}
                />
              ))}
            </div>
          )}

          {/* Barras de progreso */}
          {uploadingAny && (
            <div className="space-y-3 bg-gray-900 border border-gray-800 rounded-xl p-4">
              <UploadBar label="Video principal" progress={mainUpload.progress} error={mainUpload.error} />
              {additionalFiles.map((f, i) => f && (
                <UploadBar key={i} label={`Adicional ${i + 1}`} progress={additionalUploads[i].progress} error={additionalUploads[i].error} />
              ))}
            </div>
          )}

          {/* Config de pipeline — colapsable, antes de procesar */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPipelineConfig(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span>Configuración de pipeline</span>
                <span className="text-[11px] bg-gray-800 text-gray-500 px-2 py-0.5 rounded">
                  {featureExtractor === 'sift' ? 'SIFT' : 'SuperPoint'} · {trainer === 'opensplat' ? 'OpenSplat' : 'gsplat'}
                </span>
              </span>
              <span className="text-gray-600">{showPipelineConfig ? '▲' : '▼'}</span>
            </button>
            {showPipelineConfig && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-800 pt-4">
                <div className="space-y-1.5">
                  <p className="text-xs text-gray-500">Extracción de features (SfM)</p>
                  <div className="flex gap-2">
                    {(['sift', 'superpoint'] as FeatureExtractor[]).map(opt => (
                      <button key={opt} type="button" onClick={() => setFeatureExtractor(opt)}
                        className={`flex-1 text-xs px-3 py-2.5 rounded-lg border transition-colors ${featureExtractor === opt ? 'bg-violet-600/20 border-violet-500 text-violet-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                        <span className="font-medium block">{opt === 'sift' ? 'SIFT' : 'SuperPoint + LightGlue'}</span>
                        <span className="text-[10px] text-gray-500 block mt-0.5">{opt === 'sift' ? 'Rápido, estable' : 'Mejor calidad en interiores +~5 min'}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-gray-500">Trainer de Gaussian Splatting</p>
                  <div className="flex gap-2">
                    {(['opensplat', 'gsplat'] as Trainer[]).map(opt => (
                      <button key={opt} type="button" onClick={() => setTrainer(opt)}
                        className={`flex-1 text-xs px-3 py-2.5 rounded-lg border transition-colors ${trainer === opt ? 'bg-violet-600/20 border-violet-500 text-violet-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                        <span className="font-medium block">{opt === 'opensplat' ? 'OpenSplat' : 'gsplat'}</span>
                        <span className="text-[10px] text-gray-500 block mt-0.5">{opt === 'opensplat' ? 'Estable, probado' : 'Experimental, antialiased'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-950/30 rounded-lg px-4 py-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={!mainFile || !name || !clientName || uploadingAny || submitting || mainWarning?.blocked}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white py-3 rounded-lg font-medium transition-colors"
          >
            {uploadingAny || submitting
              ? activeAdditionals > 0 ? `Subiendo ${1 + activeAdditionals} videos...` : 'Subiendo video...'
              : mainWarning?.warning ? 'Confirmar y procesar' : 'Procesar tour 3D'}
          </button>
        </form>
      </div>
    </div>
  )
}
