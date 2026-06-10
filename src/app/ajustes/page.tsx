'use client'

import { useState, useEffect } from 'react'
import { type FeatureExtractor, type Trainer } from '@/lib/supabase'

// Defaults globales — almacenados en localStorage del operador.
// Se pre-seleccionan en /nuevo al crear un proyecto.
export default function AjustesPage() {
  const [fe, setFe] = useState<FeatureExtractor>('sift')
  const [trainer, setTrainer] = useState<Trainer>('opensplat')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setFe((localStorage.getItem('default_feature_extractor') as FeatureExtractor) ?? 'sift')
    setTrainer((localStorage.getItem('default_trainer') as Trainer) ?? 'opensplat')
  }, [])

  function save() {
    localStorage.setItem('default_feature_extractor', fe)
    localStorage.setItem('default_trainer', trainer)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-xl mx-auto">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Proyectos</a>
        <h1 className="text-2xl font-bold mt-4 mb-2">Ajustes</h1>
        <p className="text-gray-500 text-sm mb-8">
          Los valores que configures aquí se pre-seleccionarán al crear nuevos proyectos.
          Puedes cambiarlos por proyecto en el formulario de subida.
        </p>

        <div className="space-y-6">
          {/* Pipeline defaults */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300">Pipeline de procesamiento (defaults)</h2>

            <div className="space-y-2">
              <p className="text-xs text-gray-500">Extracción de features (SfM / COLMAP)</p>
              <div className="flex gap-2">
                {(['sift', 'superpoint'] as FeatureExtractor[]).map(opt => (
                  <button key={opt} onClick={() => setFe(opt)}
                    className={`flex-1 text-left px-4 py-3 rounded-xl border transition-colors ${fe === opt ? 'bg-violet-600/20 border-violet-500 text-violet-200' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                    <p className="font-medium text-sm">{opt === 'sift' ? 'SIFT' : 'SuperPoint + LightGlue'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {opt === 'sift'
                        ? 'Rápido y estable. Puede fallar en paredes lisas o zonas sin textura.'
                        : 'Mejor calidad en interiores, especialmente con paredes blancas. +5 min por proyecto.'}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-gray-500">Trainer de Gaussian Splatting</p>
              <div className="flex gap-2">
                {(['opensplat', 'gsplat'] as Trainer[]).map(opt => (
                  <button key={opt} onClick={() => setTrainer(opt)}
                    className={`flex-1 text-left px-4 py-3 rounded-xl border transition-colors ${trainer === opt ? 'bg-violet-600/20 border-violet-500 text-violet-200' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                    <p className="font-medium text-sm">{opt === 'opensplat' ? 'OpenSplat' : 'gsplat (antialiased)'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {opt === 'opensplat'
                        ? 'Estable y probado. El trainer actual de producción.'
                        : 'Experimental. Mejor calidad con anti-aliasing. En validación activa.'}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <button onClick={save}
              className="bg-violet-600 hover:bg-violet-500 text-white text-sm px-5 py-2.5 rounded-lg font-medium transition-colors">
              {saved ? '✓ Guardado' : 'Guardar defaults'}
            </button>
          </section>

          {/* Futura sección: viewer config */}
          <section className="bg-gray-900/40 border border-gray-800/50 rounded-xl p-5 opacity-50 select-none">
            <h2 className="text-sm font-semibold text-gray-500">Configuración del viewer (próximamente)</h2>
            <p className="text-xs text-gray-600 mt-1">Posición inicial de cámara, calidad de entrega, watermark del tour público.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
