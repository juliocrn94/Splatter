'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, Project } from '@/lib/supabase'

export default function EntregaPage() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.from('projects').select('*').eq('id', id).single().then(({ data }) => setProject(data))
  }, [id])

  function copyLink() {
    if (!project) return
    const url = `${process.env.NEXT_PUBLIC_APP_URL}/tour/${project.slug}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!project) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Cargando...</div>
  }

  const tourUrl = `${process.env.NEXT_PUBLIC_APP_URL}/tour/${project.slug}`

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-lg mx-auto">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Proyectos</a>

        <div className="mt-8 mb-8">
          <div className="text-3xl mb-3">🎉</div>
          <h1 className="text-2xl font-bold">Tour listo</h1>
          <p className="text-gray-400 mt-1">{project.name} · {project.client_name}</p>
        </div>

        {/* Link */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mb-4">
          <p className="text-sm text-gray-400 mb-3">Link para compartir con el cliente</p>
          <div className="bg-gray-800 rounded-lg px-4 py-3 font-mono text-sm text-violet-300 break-all mb-3">
            {tourUrl}
          </div>
          <div className="flex gap-3">
            <button
              onClick={copyLink}
              className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {copied ? '¡Copiado!' : 'Copiar link'}
            </button>
            <a
              href={tourUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 border border-gray-700 hover:border-gray-500 text-gray-300 py-2.5 rounded-lg text-sm text-center transition-colors"
            >
              Abrir tour →
            </a>
          </div>
        </div>

        <p className="text-gray-600 text-xs text-center">
          El link funciona en cualquier celular, tablet o computadora. Sin app requerida.
        </p>
      </div>
    </div>
  )
}
