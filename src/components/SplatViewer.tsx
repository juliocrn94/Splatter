'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  url: string
  className?: string
  debug?: boolean
}

// Viewer de Gaussian Splatting basado en Spark (@sparkjsdev/spark) sobre Three.js.
// Spark soporta .spz nativo (formato v1-3 gzip) — lo que genera nuestro pipeline.
export default function SplatViewer({ url, className, debug }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [diag, setDiag] = useState<string>('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let raf = 0
    let renderer: import('three').WebGLRenderer | null = null
    let camera: import('three').PerspectiveCamera | null = null
    let controls: { update: () => void; dispose: () => void } | null = null
    let splat: { dispose: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null

    // Tamaño robusto: lee dimensiones reales del contenedor (no 0 al montar).
    function applySize() {
      if (!renderer || !camera || !container) return
      const w = container.clientWidth || window.innerWidth
      const h = container.clientHeight || window.innerHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    async function init() {
      const THREE = await import('three')
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
      const { SplatMesh, SplatFileType } = await import('@sparkjsdev/spark')

      if (disposed || !container) return

      const scene = new THREE.Scene()
      const w0 = container.clientWidth || window.innerWidth
      const h0 = container.clientHeight || window.innerHeight
      camera = new THREE.PerspectiveCamera(60, w0 / h0, 0.01, 1000)
      camera.position.set(0, 0, 5)

      renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(w0, h0, false)
      renderer.setClearColor(0x000000, 0)
      container.appendChild(renderer.domElement)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'

      const orbit = new OrbitControls(camera, renderer.domElement)
      orbit.enableDamping = true
      orbit.dampingFactor = 0.05
      controls = orbit

      // Re-dimensiona cuando el contenedor cambia de tamaño (incluye 0→real al montar).
      resizeObserver = new ResizeObserver(() => applySize())
      resizeObserver.observe(container)

      const mesh = new SplatMesh({ url, fileType: SplatFileType.SPZ })
      mesh.quaternion.set(1, 0, 0, 0) // splats de COLMAP/OpenSplat: Y invertido → 180° en X
      scene.add(mesh)
      splat = mesh

      try {
        await mesh.initialized
        if (disposed) return
        applySize()

        // Encuadre con el getBoundingBox NATIVO de Spark (Box3.setFromObject de Three
        // no funciona con la geometría procedural de Spark → caja vacía).
        mesh.updateMatrixWorld(true)
        const box = mesh.getBoundingBox(true)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
        console.log('[SplatViewer] bbox size:', size.toArray(), 'center:', center.toArray())

        const maxDim = Math.max(size.x, size.y, size.z)
        const numSplats = (mesh as unknown as { getNumSplats?: () => number }).getNumSplats?.() ?? -1
        if (box && !box.isEmpty() && isFinite(maxDim) && maxDim > 0) {
          const dist = maxDim * 1.5
          orbit.target.copy(center)
          camera.position.set(center.x, center.y + size.y * 0.15, center.z + dist)
          camera.near = Math.max(dist / 1000, 0.001)
          camera.far = dist * 100
          camera.updateProjectionMatrix()
          orbit.update()
        }
        const wh = `${container.clientWidth}x${container.clientHeight}`
        setDiag(
          `splats: ${numSplats.toLocaleString()} | bbox: ${size.x.toFixed(1)},${size.y.toFixed(1)},${size.z.toFixed(1)} | ` +
          `center: ${center.x.toFixed(1)},${center.y.toFixed(1)},${center.z.toFixed(1)} | ` +
          `cam: ${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)} | canvas: ${wh}`,
        )
        setStatus('ready')
      } catch (err) {
        console.error('[SplatViewer] error cargando splat:', err)
        if (!disposed) setStatus('error')
        return
      }

      const animate = () => {
        raf = requestAnimationFrame(animate)
        orbit.update()
        renderer!.render(scene, camera!)
      }
      animate()
    }

    init().catch((err) => {
      console.error('[SplatViewer] init falló:', err)
      if (!disposed) setStatus('error')
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      controls?.dispose()
      splat?.dispose()
      if (renderer) {
        renderer.dispose()
        renderer.domElement.parentNode?.removeChild(renderer.domElement)
      }
    }
  }, [url])

  return (
    <div className={className ?? 'w-full h-full'} style={{ position: 'relative', touchAction: 'none' }}>
      <div ref={containerRef} className="absolute inset-0" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Cargando tour 3D...</p>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400">
          <p className="text-sm">No se pudo cargar el tour 3D.</p>
        </div>
      )}
      {debug && (
        <div className="absolute top-2 left-2 bg-black/70 text-green-400 text-[10px] font-mono px-2 py-1 rounded max-w-[90%] pointer-events-none">
          [{status}] {diag || 'sin datos aún'}
        </div>
      )}
    </div>
  )
}
