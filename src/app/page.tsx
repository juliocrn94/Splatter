'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { supabase, Project, STATUS_LABELS, STATUS_COLORS } from '@/lib/supabase'

const PROCESSING_STEPS = [
  { label: 'Iniciando GPU',      pct: 10, duration: 180 },
  { label: 'Extrayendo frames',  pct: 25, duration: 120 },
  { label: 'COLMAP',             pct: 55, duration: 360 },
  { label: 'OpenSplat',          pct: 85, duration: 600 },
  { label: 'Guardando archivos', pct: 95, duration: 120 },
]
const TOTAL_SECS = PROCESSING_STEPS.reduce((a, s) => a + s.duration, 0)

function MiniProgress({ startedAt }: { startedAt: string | null }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    const t = setInterval(tick, 5000)
    return () => clearInterval(t)
  }, [startedAt])

  let cumulative = 0, currentStep = 0
  for (let i = 0; i < PROCESSING_STEPS.length; i++) {
    if (elapsed >= cumulative + PROCESSING_STEPS[i].duration) {
      cumulative += PROCESSING_STEPS[i].duration
      currentStep = i + 1
    } else break
  }
  currentStep = Math.min(currentStep, PROCESSING_STEPS.length - 1)
  const stepElapsed = elapsed - cumulative
  const stepDur = PROCESSING_STEPS[currentStep]?.duration ?? 1
  const pctStart = currentStep === 0 ? 0 : PROCESSING_STEPS[currentStep - 1].pct
  const pctEnd   = PROCESSING_STEPS[currentStep]?.pct ?? 100
  const pct = Math.min(Math.round(pctStart + (pctEnd - pctStart) * Math.min(stepElapsed / stepDur, 1)), 99)
  const label = PROCESSING_STEPS[currentStep]?.label ?? 'Procesando...'
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span>{pct}% · {mins}m {secs}s</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-1">
        <div className="bg-violet-500 h-1 rounded-full transition-all duration-5000" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function HomePage() {
  const [projects, setProjects]   = useState<Project[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [menuId, setMenuId]       = useState<string | null>(null)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [editName, setEditName]   = useState('')
  const [editClient, setEditClient] = useState('')
  const [deleteId, setDeleteId]   = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase
      .from('projects')
      .select('*')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setProjects(data ?? []); setLoading(false) })

    const channel = supabase
      .channel('projects-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setProjects((prev) => [payload.new as Project, ...prev])
        } else if (payload.eventType === 'UPDATE') {
          setProjects((prev) =>
            prev.map((p) => p.id === (payload.new as Project).id ? payload.new as Project : p).filter((p) => p.status !== 'deleted')
          )
        } else if (payload.eventType === 'DELETE') {
          setProjects((prev) => prev.filter((p) => p.id !== (payload.old as Project).id))
        }
      })
      .subscribe()

    // Cerrar menú al hacer click fuera
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => { supabase.removeChannel(channel); document.removeEventListener('mousedown', handleClick) }
  }, [])

  const filtered = projects.filter((p) => {
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.client_name.toLowerCase().includes(q) ||
      (p.project_code?.toLowerCase() ?? '').includes(q)
    )
  })

  function getProjectHref(p: Project) {
    if (p.status === 'reviewing' || p.status === 'reprocessing') return `/proyecto/${p.id}/revisar`
    if (p.status === 'delivered') return `/proyecto/${p.id}/entrega`
    return `/proyecto/${p.id}`
  }

  function openEdit(p: Project, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    setEditProject(p)
    setEditName(p.name)
    setEditClient(p.client_name)
    setMenuId(null)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editProject) return
    setSaving(true)
    const res = await fetch(`/api/projects/${editProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, clientName: editClient }),
    })
    if (res.ok) {
      const { project } = await res.json()
      setProjects((prev) => prev.map((p) => p.id === project.id ? project : p))
    }
    setSaving(false)
    setEditProject(null)
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    await fetch(`/api/projects/${deleteId}`, { method: 'DELETE' })
    setProjects((prev) => prev.filter((p) => p.id !== deleteId))
    setSaving(false)
    setDeleteId(null)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Splatter</h1>
            <p className="text-gray-400 text-sm mt-1">Tours 3D — Dashboard operador</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/guia" className="text-sm text-gray-400 hover:text-white border border-gray-700 px-4 py-2 rounded-lg transition-colors">
              Cómo grabar
            </Link>
            <Link href="/nuevo" className="bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-lg font-medium transition-colors">
              + Nuevo proyecto
            </Link>
          </div>
        </div>

        {/* Buscador */}
        <div className="relative mb-6">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, cliente o código (SPL-CDMX-...)"
            className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 pl-10 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 text-sm"
          />
          <span className="absolute left-3 top-3.5 text-gray-600 text-sm">🔍</span>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-3 text-gray-600 hover:text-gray-400 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Lista */}
        {loading ? (
          <div className="text-gray-500 text-center py-20">Cargando...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 mb-2">{search ? `Sin resultados para "${search}"` : 'No hay proyectos aún'}</p>
            {!search && (
              <Link href="/nuevo" className="text-violet-400 hover:text-violet-300 text-sm">
                Crear el primer proyecto →
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((p) => (
              <div key={p.id} className="relative group">
                <Link
                  href={getProjectHref(p)}
                  className="block bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-xl p-5 transition-colors pr-16"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">{p.name}</p>
                        {p.project_code && (
                          <span className="text-xs font-mono bg-gray-800 text-violet-300 px-2 py-0.5 rounded">
                            {p.project_code}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mt-0.5">{p.client_name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`text-sm font-medium ${STATUS_COLORS[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                      <p className="text-xs text-gray-600 mt-1">
                        {new Date(p.created_at).toLocaleDateString('es-MX')}
                      </p>
                    </div>
                  </div>
                  {(p.status === 'processing' || p.status === 'reprocessing') && (
                    <MiniProgress startedAt={p.processing_started_at} />
                  )}
                  {p.status === 'failed' && p.error_message && (
                    <p className="mt-3 text-sm text-red-400 bg-red-950/30 rounded-lg px-3 py-2">
                      {p.error_message}
                    </p>
                  )}
                </Link>

                {/* Botón de menú ⋯ */}
                <div className="absolute right-4 top-4" ref={menuId === p.id ? menuRef : null}>
                  <button
                    onClick={(e) => { e.preventDefault(); setMenuId(menuId === p.id ? null : p.id) }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-600 hover:text-white hover:bg-gray-700 transition-colors"
                  >
                    ⋯
                  </button>

                  {menuId === p.id && (
                    <div className="absolute right-0 top-9 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-10 overflow-hidden">
                      <button
                        onClick={(e) => openEdit(p, e)}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                      >
                        ✏️ Editar nombre
                      </button>
                      <Link
                        href={getProjectHref(p)}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                        onClick={() => setMenuId(null)}
                      >
                        👁 Ver proyecto
                      </Link>
                      {p.status === 'failed' && (
                        <button
                          onClick={async (e) => {
                            e.preventDefault(); e.stopPropagation()
                            setMenuId(null)
                            const res = await fetch(`/api/projects/${p.id}/retry`, { method: 'POST' })
                            if (res.ok) {
                              const { reused } = await res.json()
                              if (!reused) window.location.href = '/nuevo'
                              else setProjects(prev => prev.map(x => x.id === p.id ? { ...x, status: 'processing', error_message: null } : x))
                            }
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-violet-400 hover:bg-violet-950/30 flex items-center gap-2"
                        >
                          🔄 Reintentar
                        </button>
                      )}
                      <button
                        onClick={async (e) => { e.preventDefault(); e.stopPropagation()
                          await fetch(`/api/projects/${p.id}`, {
                            method: 'PATCH',
                            headers: {'Content-Type':'application/json'},
                            body: JSON.stringify({ isLocked: !p.is_locked })
                          })
                          setMenuId(null)
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                      >
                        {p.is_locked ? '🔓 Desbloquear tour' : '🔒 Bloquear tour'}
                      </button>
                      {p.status === 'delivered' && (
                        <a
                          href={`/tour/${p.slug}`}
                          target="_blank"
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2 block"
                          onClick={() => setMenuId(null)}
                        >
                          🔗 Abrir tour
                        </a>
                      )}
                      <div className="border-t border-gray-700" />
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteId(p.id); setMenuId(null) }}
                        className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-950/30 flex items-center gap-2"
                      >
                        🗑 Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {search && filtered.length > 0 && (
          <p className="text-center text-xs text-gray-600 mt-4">
            {filtered.length} de {projects.length} proyectos
          </p>
        )}
      </div>

      {/* Modal editar */}
      {editProject && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">Editar proyecto</h2>
            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Nombre del proyecto</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Desarrolladora / cliente</label>
                <input
                  type="text"
                  value={editClient}
                  onChange={(e) => setEditClient(e.target.value)}
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditProject(null)}
                  className="flex-1 border border-gray-700 text-gray-400 py-2.5 rounded-lg text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 rounded-lg text-sm font-medium"
                >
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal confirmar eliminación */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-2">¿Eliminar proyecto?</h2>
            <p className="text-gray-400 text-sm mb-5">
              Esta acción no se puede deshacer. El proyecto y sus archivos serán eliminados permanentemente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 border border-gray-700 text-gray-400 py-2.5 rounded-lg text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="flex-1 bg-red-700 hover:bg-red-600 text-white py-2.5 rounded-lg text-sm font-medium"
              >
                {saving ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
