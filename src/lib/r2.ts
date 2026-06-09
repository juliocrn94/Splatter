import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Cliente R2 lazy — solo se instancia en server (API routes), nunca en browser
let _r2: S3Client | null = null
function getR2(): S3Client {
  if (!_r2) {
    _r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return _r2
}

function getBucket(): string {
  return process.env.R2_BUCKET_NAME!
}

// Límites de upload en bytes — seguros para importar en browser (no usan env vars server-only)
export const UPLOAD_LIMITS = {
  SOFT:  2 * 1024 * 1024 * 1024,
  HARD:  4 * 1024 * 1024 * 1024,
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
      estimatedMinutes: Math.round(gb * 22),
      estimatedCostUSD: parseFloat((gb * 0.13).toFixed(2)),
    }
  }
  return { blocked: false, warning: false, estimatedMinutes: 0, estimatedCostUSD: 0 }
}

// Solo llamar desde API routes (server-side)
export async function getPresignedUploadUrl(key: string, contentType: string) {
  return getSignedUrl(
    getR2(),
    new PutObjectCommand({ Bucket: getBucket(), Key: key, ContentType: contentType }),
    { expiresIn: 600 }
  )
}

export function getPublicUrl(key: string) {
  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${key}`
}
