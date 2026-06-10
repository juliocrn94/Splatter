'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import SplatViewer from '@/components/SplatViewer'

// Valida que la URL del .spz venga del bucket R2 esperado (evita SSRF/abuso del iframe).
function isAllowedSpzUrl(url: string): boolean {
  try {
    const parsed  = new URL(url)
    const allowed = new URL(process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '')
    return parsed.origin === allowed.origin
  } catch {
    return false
  }
}

function ViewerContent() {
  const params = useSearchParams()
  const rawUrl = params.get('spz')
  const spzUrl = rawUrl && isAllowedSpzUrl(rawUrl) ? rawUrl : null

  if (!spzUrl) {
    return (
      <div className="h-screen bg-black flex items-center justify-center text-gray-500">
        {rawUrl ? 'URL del tour no válida' : 'URL del tour no especificada'}
      </div>
    )
  }

  return <SplatViewer url={spzUrl} className="w-full h-screen bg-black" />
}

export default function ViewerPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-black" />}>
      <ViewerContent />
    </Suspense>
  )
}
