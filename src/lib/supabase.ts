import { createClient } from '@supabase/supabase-js'

export type ProjectStatus =
  | 'uploading'
  | 'processing'
  | 'reviewing'
  | 'reprocessing'
  | 'delivered'
  | 'failed'

export type ProjectQuality = 'standard' | 'hq'

export interface Project {
  id: string
  created_at: string
  name: string
  client_name: string
  slug: string
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
}

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  uploading:     'Subiendo video',
  processing:    'Procesando',
  reviewing:     'Listo para revisar',
  reprocessing:  'Reprocesando en alta calidad',
  delivered:     'Entregado',
  failed:        'Error',
}

export const STATUS_COLORS: Record<ProjectStatus, string> = {
  uploading:    'text-blue-500',
  processing:   'text-yellow-500',
  reviewing:    'text-green-500',
  reprocessing: 'text-purple-500',
  delivered:    'text-gray-500',
  failed:       'text-red-500',
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
