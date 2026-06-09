import { createClient } from '@supabase/supabase-js'

export type ProjectStatus =
  | 'uploading'
  | 'processing'
  | 'reviewing'
  | 'reprocessing'
  | 'delivered'
  | 'failed'
  | 'deleted'

export type ProjectQuality = 'standard' | 'hq'

export interface Project {
  id: string
  created_at: string
  name: string
  client_name: string
  slug: string
  project_code: string       // SPL-CDMX-00001-A
  city: string               // CDMX, GDL, MTY...
  status: ProjectStatus
  error_message: string | null
  video_r2_key: string | null
  ply_r2_key: string | null
  spz_r2_key: string | null
  runpod_job_id: string | null
  quality: ProjectQuality
  processing_started_at: string | null
  delivered_at: string | null
  notes: string | null
  contact_phone: string | null
  is_locked: boolean
  deleted_at: string | null
}

// Genera el código incremental: SPL-CDMX-00001-A
// Usa MAX del número existente para garantizar monotónico aunque haya gaps
// (ej: proyectos eliminados, retries fallidos, etc.)
export async function generateProjectCode(city: string = 'CDMX'): Promise<string> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Obtener el código más alto existente para esta ciudad (incluyendo eliminados)
  const { data } = await db
    .from('projects')
    .select('project_code')
    .like('project_code', `SPL-${city}-%`)
    .order('project_code', { ascending: false })
    .limit(1)

  let nextNum = 1
  if (data && data.length > 0 && data[0].project_code) {
    // Parsear el número del código más alto: SPL-CDMX-00003-B → 3
    const parts = data[0].project_code.split('-')
    const parsed = parseInt(parts[2], 10)
    if (!isNaN(parsed)) nextNum = parsed + 1
  }

  return `SPL-${city}-${String(nextNum).padStart(5, '0')}-A`
}

// Incrementa la letra de versión: SPL-CDMX-00001-A → SPL-CDMX-00001-B
export function nextProjectCodeVersion(code: string): string {
  const parts = code.split('-')
  if (parts.length < 4) return code
  const currentLetter = parts[parts.length - 1]
  const nextLetter = currentLetter >= 'Z'
    ? 'Z'
    : String.fromCharCode(currentLetter.charCodeAt(0) + 1)
  return [...parts.slice(0, -1), nextLetter].join('-')
}

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  uploading:     'Subiendo video',
  processing:    'Procesando',
  reviewing:     'Listo para revisar',
  reprocessing:  'Reprocesando en alta calidad',
  delivered:     'Entregado',
  failed:        'Error',
  deleted:       'Eliminado',
}

export const STATUS_COLORS: Record<ProjectStatus, string> = {
  uploading:    'text-blue-500',
  processing:   'text-yellow-500',
  reviewing:    'text-green-500',
  reprocessing: 'text-purple-500',
  delivered:    'text-gray-500',
  failed:       'text-red-500',
  deleted:      'text-gray-700',
}

// Cliente browser — lazy para evitar errores en la evaluación del módulo
let _supabase: ReturnType<typeof createClient> | null = null

export function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
    _supabase = createClient(url, key)
  }
  return _supabase
}

// Alias para compatibilidad con el código existente
export const supabase = {
  from: (...args: Parameters<ReturnType<typeof createClient>['from']>) => getSupabase().from(...args),
  channel: (...args: Parameters<ReturnType<typeof createClient>['channel']>) => getSupabase().channel(...args),
  removeChannel: (...args: Parameters<ReturnType<typeof createClient>['removeChannel']>) => getSupabase().removeChannel(...args),
}

// Cliente servidor (usa service role — solo en API routes)
export const supabaseAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
