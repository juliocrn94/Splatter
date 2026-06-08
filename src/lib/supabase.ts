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

// Cliente browser — soporta tanto el nombre nuevo (PUBLISHABLE_KEY) como el viejo (ANON_KEY)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

// Cliente servidor (usa service role — solo en API routes)
export const supabaseAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
