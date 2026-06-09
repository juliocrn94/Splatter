import { NextRequest, NextResponse } from 'next/server'
import { getPresignedUploadUrl, UPLOAD_LIMITS } from '@/lib/r2'
import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/auth'

const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/mpeg',
  'video/3gpp',
  'video/x-ms-wmv',
]

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req)
  if (authError) return authError

  const { filename, contentType, sizeBytes } = await req.json()

  if (!filename || !contentType || typeof sizeBytes !== 'number') {
    return NextResponse.json({ error: 'filename, contentType y sizeBytes son requeridos' }, { status: 400 })
  }

  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    return NextResponse.json({ error: 'Solo se aceptan archivos de video' }, { status: 400 })
  }

  if (sizeBytes > UPLOAD_LIMITS.HARD) {
    return NextResponse.json({
      error: 'El video es muy grande. Graba videos de máximo 20 minutos para mejores resultados.'
    }, { status: 413 })
  }

  const rawExt = filename.split('.').pop() ?? 'mp4'
  const ext    = rawExt.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'mp4'
  const key    = `videos/${randomUUID()}.${ext}`
  const url = await getPresignedUploadUrl(key, contentType)

  return NextResponse.json({ url, key })
}
