import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Variable de entorno requerida no encontrada: ${key}`)
  return val
}

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  },
})

export const BUCKET = requireEnv('R2_BUCKET_NAME')

// Límites de upload en bytes
export const UPLOAD_LIMITS = {
  SOFT:  2 * 1024 * 1024 * 1024, // 2GB — muestra warning con estimación
  HARD:  4 * 1024 * 1024 * 1024, // 4GB — bloqueado
}

export function getUploadWarning(bytes: number): {
  blocked: boolean
  warning: boolean
  estimatedMinutes: number
  estimatedCostUSD: number
} {
  if (bytes > UPLOAD_LIMITS.HARD) {
    return { blocked: true, warning: false, estimatedMinutes: 0, estimatedCostUSD: 0 }
  }
  if (bytes > UPLOAD_LIMITS.SOFT) {
    const gb = bytes / (1024 ** 3)
    return {
      blocked: false,
      warning: true,
      estimatedMinutes: Math.round(gb * 22), // ~22 min por GB
      estimatedCostUSD: parseFloat((gb * 0.13).toFixed(2)),
    }
  }
  return { blocked: false, warning: false, estimatedMinutes: 0, estimatedCostUSD: 0 }
}

export async function getPresignedUploadUrl(key: string, contentType: string) {
  return getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: contentType,
    }),
    { expiresIn: 3600 } // 1 hora para completar el upload
  )
}

export function getPublicUrl(key: string) {
  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${key}`
}
