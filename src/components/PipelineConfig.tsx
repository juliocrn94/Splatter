'use client'

import { useState } from 'react'
import { type FeatureExtractor, type Trainer, FEATURE_EXTRACTOR_LABELS, TRAINER_LABELS } from '@/lib/supabase'

interface Props {
  projectId: string
  featureExtractor: FeatureExtractor
  trainer: Trainer
  disabled?: boolean
  onSaved?: (fe: FeatureExtractor, tr: Trainer) => void
}

// Panel de configuración de pipeline por proyecto.
// Permite al operador elegir feature extractor (SIFT vs SuperPoint+LightGlue) y trainer.
// Los cambios aplican en el PRÓXIMO procesamiento (retry o reproceso).
export default function PipelineConfig({ projectId, featureExtractor, trainer, disabled, onSaved }: Props) {
  const [fe, setFe] = useState<FeatureExtractor>(featureExtractor)
  const [tr, setTr] = useState<Trainer>(trainer)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const isDirty = fe !== featureExtractor || tr !== trainer

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_extractor: fe, trainer: tr }),
      })
      if (!res.ok) throw new Error('Error al guardar')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved?.(fe, tr)
    } catch {
      setError('No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Configuración de pipeline</p>
        <p className="text-[10px] text-gray-600">Aplica en el próximo procesamiento</p>
      </div>

      {/* Feature extractor */}
      <div className="space-y-1.5">
        <p className="text-xs text-gray-500">Extracción de features (SfM)</p>
        <div className="flex gap-2">
          {(['sift', 'superpoint'] as FeatureExtractor[]).map((opt) => (
            <button
              key={opt}
              onClick={() => setFe(opt)}
              disabled={disabled}
              className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                fe === opt
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <span className="font-medium block">{opt === 'sift' ? 'SIFT' : 'SuperPoint'}</span>
              <span className="text-[10px] text-gray-500 block mt-0.5">
                {opt === 'sift' ? 'Rápido, default' : 'Mejor calidad +~5min'}
              </span>
            </button>
          ))}
        </div>
        {fe === 'superpoint' && (
          <p className="text-[10px] text-amber-400/80 bg-amber-950/30 border border-amber-800/50 rounded-lg px-2.5 py-1.5">
            SuperPoint+LightGlue mejora notablemente la reconstrucción en interiores con paredes lisas. Requiere imagen de worker con hloc instalado.
          </p>
        )}
      </div>

      {/* Trainer */}
      <div className="space-y-1.5">
        <p className="text-xs text-gray-500">Trainer de Gaussian Splatting</p>
        <div className="flex gap-2">
          {(['opensplat', 'gsplat'] as Trainer[]).map((opt) => (
            <button
              key={opt}
              onClick={() => setTr(opt)}
              disabled={disabled}
              className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                tr === opt
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <span className="font-medium block">{opt === 'opensplat' ? 'OpenSplat' : 'gsplat'}</span>
              <span className="text-[10px] text-gray-500 block mt-0.5">
                {opt === 'opensplat' ? 'Estable, probado' : 'Experimental, antialiased'}
              </span>
            </button>
          ))}
        </div>
        {tr === 'gsplat' && (
          <p className="text-[10px] text-amber-400/80 bg-amber-950/30 border border-amber-800/50 rounded-lg px-2.5 py-1.5">
            gsplat está en validación. Requiere el endpoint de RunPod con imagen gsplat-validation.
          </p>
        )}
      </div>

      {/* Acción */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={save}
          disabled={!isDirty || saving || disabled}
          className="text-xs bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white px-4 py-2 rounded-lg transition-colors font-medium"
        >
          {saving ? 'Guardando...' : 'Guardar config'}
        </button>
        {saved && <span className="text-xs text-green-400">✓ Guardado</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
