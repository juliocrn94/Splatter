'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  url: string
  className?: string
}

// Viewer de Gaussian Splatting basado en Spark (@sparkjsdev/spark) sobre Three.js.
// Spark soporta .spz nativo — el formato que genera nuestro pipeline para entrega.
export default function SplatViewer({ url, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let raf = 0
    // refs locales para cleanup
    let renderer: import('three').WebGLRenderer | null = null
    let controls: { update: () => void; dispose: () => void } | null = null
    let splat: { dispose: () => void } | null = null
    let onResize: (() => void) | null = null

    async function init() {
      const THREE = await import('three')
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
      const { SplatMesh, SplatFileType } = await import('@sparkjsdev/spark')

      if (disposed || !container) return

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(
        60,
        container.clientWidth / container.clientHeight,
        0.1,
        1000,
      )
      camera.position.set(0, 0, 5)

      renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(container.clientWidth, container.clientHeight)
      renderer.setClearColor(0x000000, 0)
      container.appendChild(renderer.domElement)

      const orbit = new OrbitControls(camera, renderer.domElement)
      orbit.enableDamping = true
      orbit.dampingFactor = 0.05
      controls = orbit

      const mesh = new SplatMesh({ url, fileType: SplatFileType.SPZ })
      // Los splats de OpenSplat/COLMAP vienen con Y invertido respecto a Three.js.
      // 180° en X los pone derechos.
      mesh.quaternion.set(1, 0, 0, 0)
      scene.add(mesh)
      splat = mesh

      try {
        await mesh.initialized
        if (disposed) return

        // Auto-encuadre con el bounding box REAL de Spark (getBoundingBox),
        // no el Box3.setFromObject de Three.js (no funciona con geometría procedural).
        // centers_only=true evita que splats con escala grande inflen la caja.
        mesh.updateMatrixWorld(true)
        const box = mesh.getBoundingBox(true)
        if (box && !box.isEmpty() && isFinite(box.min.x)) {
          const center = box.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
          const size = box.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z) || 4
          const dist = maxDim * 1.5
          orbit.target.copy(center)
          camera.position.set(center.x, center.y + size.y * 0.1, center.z + dist)
          camera.near = Math.max(dist / 1000, 0.001)
          camera.far = dist * 100
          camera.updateProjectionMatrix()
          orbit.update()
        }
        setStatus('ready')
      } catch (err) {
        console.error('[SplatViewer] error cargando splat:', err)
        if (!disposed) setStatus('error')
        return
      }

      const animate = () => {
        raf = requestAnimationFrame(animate)
        orbit.update()
        renderer!.render(scene, camera)
      }
      animate()

      onResize = () => {
        if (!container || !renderer) return
        const w = container.clientWidth
        const h = container.clientHeight
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
      window.addEventListener('resize', onResize)
    }

    init().catch(() => { if (!disposed) setStatus('error') })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      if (onResize) window.removeEventListener('resize', onResize)
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
      <div ref={containerRef} className="w-full h-full" />
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
    </div>
  )
}
