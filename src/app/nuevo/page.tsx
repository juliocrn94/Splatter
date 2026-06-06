'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { supabase } from '@/lib/supabase'
import { getUploadWarning } from '@/lib/r2'

export default function NuevoPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [warning, setWarning] = useState<ReturnType<typeof getUploadWarning> | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0]
    if (!f) return
    setFile(f)
    setWarning(getUploadWarning(f.size))
    setError('')
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    maxFiles: 1,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !name || !clientName) return
    if (warning?.blocked) return

    setUploading(true)
    setError('')

    try {
      // 1. Crear el proyecto en Supabase
      const slug = name
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        + '-' + Date.now().toString(36)

      const { data: project, error: dbErr } = await supabase
        .from('projects')
        .insert({ name, client_name: clientName, slug, status: 'uploading' })
        .select()
        .single()

      if (dbErr || !project) throw new Error('No se pudo crear el proyecto')

      // 2. Obtener presigned URL para upload directo a R2
      const presignRes = await fetch('/api/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename:    file.name,
          contentType: file.type,
          sizeBytes:   file.size,
        }),
      })

      if (!presignRes.ok) {
        const { error: msg } = await presignRes.json()
        throw new Error(msg)
      }

      const { url, key } = await presignRes.json()

      // 3. Subir video DIRECTO a R2 (no pasa por Vercel)
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100))
      })

      await new Promise<void>((resolve, reject) => {
        xhr.open('PUT', url)
        xhr.setRequestHeader('Content-Type', file.type)
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error('Error al subir el video'))
        xhr.onerror = () => reject(new Error('Error de red al subir el video'))
        xhr.send(file)
      })

      // 4. Disparar pipeline de procesamiento
      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, videoKey: key }),
      })

      if (!jobRes.ok) throw new Error('No se pudo iniciar el procesamiento')

      router.push(`/proyecto/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setUploading(false)
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
            <label className="block text-sm text-gray-400 mb-2">Video de la propiedad</label>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-violet-500 bg-violet-950/20'
                  : file
                  ? 'border-green-600 bg-green-950/20'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <input {...getInputProps()} />
              {file ? (
                <div>
                  <p className="text-green-400 font-medium">{file.name}</p>
                  <p className="text-gray-500 text-sm mt-1">
                    {(file.size / (1024 ** 3)).toFixed(2)} GB
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-gray-400">Arrastra el video aquí</p>
                  <p className="text-gray-600 text-sm mt-1">o haz clic para seleccionar</p>
                  <p className="text-gray-700 text-xs mt-3">MP4, MOV, AVI · Máx 4 GB</p>
                </div>
              )}
            </div>

            {/* Warning para videos 2-4GB */}
            {warning?.warning && (
              <div className="mt-3 bg-amber-950/40 border border-amber-700 rounded-lg p-4">
                <p className="text-amber-400 font-medium text-sm">⚠️ Video grande detectado</p>
                <p className="text-amber-200/70 text-sm mt-1">
                  Este video tardará aproximadamente{' '}
                  <strong>{warning.estimatedMinutes} minutos</strong> en procesar y costará{' '}
                  <strong>${warning.estimatedCostUSD} USD</strong> en GPU.
                </p>
                <p className="text-amber-200/50 text-xs mt-2">
                  Para procesar más rápido, graba solo las áreas principales (máx 5 minutos).
                </p>
              </div>
            )}

            {/* Bloqueado >4GB */}
            {warning?.blocked && (
              <div className="mt-3 bg-red-950/40 border border-red-700 rounded-lg p-4">
                <p className="text-red-400 font-medium text-sm">Video demasiado grande</p>
                <p className="text-red-200/70 text-sm mt-1">
                  Graba videos de máximo 20 minutos para mejores resultados.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-950/30 rounded-lg px-4 py-3">{error}</p>
          )}

          {uploading && (
            <div>
              <div className="flex justify-between text-sm text-gray-400 mb-2">
                <span>Subiendo video...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className="bg-violet-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!file || !name || !clientName || uploading || warning?.blocked}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white py-3 rounded-lg font-medium transition-colors"
          >
            {uploading ? 'Subiendo...' : warning?.warning ? 'Confirmar y procesar' : 'Procesar tour 3D'}
          </button>
        </form>
      </div>
    </div>
  )
}
