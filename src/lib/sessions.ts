// Sessions almacenadas en Supabase para sobrevivir reinicios de Vercel serverless
import { createClient } from '@supabase/supabase-js'

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function addSession(token: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  await getDB().from('operator_sessions').upsert({ token, expires_at: expiresAt })
}

export async function isValidSession(token: string): Promise<boolean> {
  const { data } = await getDB()
    .from('operator_sessions')
    .select('expires_at')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .single()
  return !!data
}
