'use client'

import { useEffect, useRef } from 'react'

interface Props {
  spzUrl: string
  projectName: string
  clientName: string
  contactPhone?: string
}

// Spark viewer (World Labs) — optimizado para mobile con .spz
// https://github.com/worldlabs-ai/spark
export default function TourViewer({ spzUrl, projectName, clientName, contactPhone }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Carga Spark dinámicamente para evitar SSR issues
    // Spark es un WebGL2 viewer ligero diseñado para .spz en mobile
    async function initSpark() {
      try {
        // @ts-expect-error — Spark no tiene tipos TypeScript aún
        const { SplatViewer } = await import('https://cdn.jsdelivr.net/npm/@sparkxr/spark@latest/dist/spark.esm.js')

        const viewer = new SplatViewer({
          container: containerRef.current!,
          url: spzUrl,
          background: '#000000',
        })

        viewer.init()
      } catch {
        // Fallback: supersplat-viewer si Spark falla
        if (!containerRef.current) return
        const iframe = document.createElement('iframe')
        iframe.src = `/viewer?spz=${encodeURIComponent(spzUrl)}`
        iframe.style.cssText = 'width:100%;height:100%;border:0'
        containerRef.current.appendChild(iframe)
      }
    }

    initSpark()
  }, [spzUrl])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Overlay con nombre del proyecto */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 pointer-events-none">
        <p className="text-white font-semibold text-lg">{projectName}</p>
        <p className="text-white/60 text-sm">{clientName}</p>
        {contactPhone && (
          <a
            href={`https://wa.me/${contactPhone.replace(/\D/g, '')}`}
            className="mt-3 inline-flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium pointer-events-auto"
            target="_blank"
            rel="noopener noreferrer"
          >
            📱 Agenda tu visita
          </a>
        )}
      </div>
    </div>
  )
}
