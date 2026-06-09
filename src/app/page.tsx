'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, Project, STATUS_LABELS, STATUS_COLORS } from '@/lib/supabase'

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setProjects(data ?? [])
        setLoading(false)
      })

    // Realtime — sin polling
    const channel = supabase
      .channel('projects-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setProjects((prev) => [payload.new as Project, ...prev])
        } else if (payload.eventType === 'UPDATE') {
          setProjects((prev) =>
            prev.map((p) => p.id === (payload.new as Project).id ? payload.new as Project : p)
          )
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Splatter</h1>
            <p className="text-gray-400 text-sm mt-1">Tours 3D — Dashboard operador</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/guia"
              className="text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 px-4 py-2.5 rounded-lg transition-colors"
            >
              Cómo grabar
            </Link>
            <Link
              href="/nuevo"
              className="bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
            >
              + Nuevo proyecto
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="text-gray-500 text-center py-20">Cargando...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 mb-4">No hay proyectos aún</p>
            <Link href="/nuevo" className="text-violet-400 hover:text-violet-300">
              Crear el primer proyecto →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={
                  p.status === 'reviewing'
                    ? `/proyecto/${p.id}/revisar`
                    : p.status === 'delivered'
                    ? `/proyecto/${p.id}/entrega`
                    : `/proyecto/${p.id}`
                }
                className="block bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-xl p-5 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2"><p className="font-semibold">{p.name}</p>{p.project_code && <span className="text-xs font-mono bg-gray-800 text-violet-300 px-2 py-0.5 rounded">{p.project_code}</span>}</div>
                    <p className="text-sm text-gray-400 mt-0.5">{p.client_name}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-medium ${STATUS_COLORS[p.status]}`}>
                      {STATUS_LABELS[p.status]}
                    </span>
                    <p className="text-xs text-gray-600 mt-1">
                      {new Date(p.created_at).toLocaleDateString('es-MX')}
                    </p>
                  </div>
                </div>
                {p.status === 'failed' && p.error_message && (
                  <p className="mt-3 text-sm text-red-400 bg-red-950/30 rounded-lg px-3 py-2">
                    {p.error_message}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
