'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

// @playcanvas/supersplat-viewer — viewer self-hosted para el dashboard del operador
// Carga .spz directamente desde R2 (CORS configurado en bucket)
function ViewerContent() {
  const params  = useSearchParams()
  const spzUrl  = params.get('spz')
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
        URL del tour no especificada
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
