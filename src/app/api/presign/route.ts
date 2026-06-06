import { NextRequest, NextResponse } from 'next/server'
import { getPresignedUploadUrl, UPLOAD_LIMITS } from '@/lib/r2'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const { filename, contentType, sizeBytes } = await req.json()

  if (!filename || !contentType || typeof sizeBytes !== 'number') {
    return NextResponse.json({ error: 'filename, contentType y sizeBytes son requeridos' }, { status: 400 })
  }

  if (!contentType.startsWith('video/')) {
    return NextResponse.json({ error: 'Solo se aceptan archivos de video' }, { status: 400 })
  }

  if (sizeBytes > UPLOAD_LIMITS.HARD) {
    return NextResponse.json({
      error: 'El video es muy grande. Graba videos de máximo 20 minutos para mejores resultados.'
    }, { status: 413 })
  }

  const ext = filename.split('.').pop() ?? 'mp4'
  const key = `videos/${randomUUID()}.${ext}`
  const url = await getPresignedUploadUrl(key, contentType)

  return NextResponse.json({ url, key })
}
