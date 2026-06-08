'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

// @playcanvas/supersplat-viewer — viewer self-hosted para el dashboard del operador
// Carga .spz directamente desde R2 (CORS configurado en bucket)
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
  const params  = useSearchParams()
  const rawUrl  = params.get('spz')
  const spzUrl  = rawUrl && isAllowedSpzUrl(rawUrl) ? rawUrl : null
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !spzUrl) return

    async function initViewer() {
      // @ts-expect-error — supersplat-viewer types mínimos
      const { SuperSplatViewer } = await import('@playcanvas/supersplat-viewer')

      new SuperSplatViewer({
        container: containerRef.current!,
        url: spzUrl!,
      })
    }

    initViewer()
  }, [spzUrl])

  if (!spzUrl) {
    return (
      <div className="h-screen bg-black flex items-center justify-center text-gray-500">
        {rawUrl ? 'URL del tour no válida' : 'URL del tour no especificada'}
      </div>
    )
  }

  return <div ref={containerRef} className="w-full h-screen bg-black" />
}

export default function ViewerPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-black" />}>
      <ViewerContent />
    </Suspense>
  )
}
