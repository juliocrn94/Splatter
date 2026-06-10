'use client'

import SplatViewer from '@/components/SplatViewer'

interface Props {
  spzUrl: string
  projectName: string
  clientName: string
  contactPhone?: string
}

// Viewer público del tour (mobile + desktop). Usa Spark (@sparkjsdev/spark) que
// carga el .spz directo desde R2.
export default function TourViewer({ spzUrl, projectName, clientName, contactPhone }: Props) {
  return (
    <div className="relative w-full h-full">
      <SplatViewer url={spzUrl} className="w-full h-full" />

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
