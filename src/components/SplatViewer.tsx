'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  url: string
  className?: string
}

// Viewer de Gaussian Splatting con navegación estilo first-person (Minecraft).
// Click en el canvas → bloquea cursor → WASD mueve, mouse mira, Scroll/QE sube/baja.
// ESC libera el cursor. El operador posiciona la cámara manualmente.
export default function SplatViewer({ url, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [locked, setLocked] = useState(false)

  const requestLock = useCallback(() => {
    containerRef.current?.querySelector('canvas')?.requestPointerLock?.()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let raf = 0
    let renderer: import('three').WebGLRenderer | null = null
    let camera: import('three').PerspectiveCamera | null = null
    let splat: { dispose: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null

    // Estado de teclas WASD + QE
    const keys: Record<string, boolean> = {}

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
      const { SplatMesh, SplatFileType, SparkRenderer } = await import('@sparkjsdev/spark')

      if (disposed || !container) return

      const scene = new THREE.Scene()
      const w0 = container.clientWidth || window.innerWidth
      const h0 = container.clientHeight || window.innerHeight
      camera = new THREE.PerspectiveCamera(75, w0 / h0, 0.001, 500)
      // Posición inicial neutral — el operador navega a donde quiere
      camera.position.set(0, 0, 0)

      renderer = new THREE.WebGLRenderer({ antialias: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.setSize(w0, h0, false)
      renderer.setClearColor(0x000000, 0)
      container.appendChild(renderer.domElement)
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair'

      const spark = new SparkRenderer({ renderer, maxStdDev: Math.sqrt(5) })
      scene.add(spark)

      resizeObserver = new ResizeObserver(() => applySize())
      resizeObserver.observe(container)

      const mesh = new SplatMesh({ url, fileType: SplatFileType.SPZ })
      mesh.quaternion.set(1, 0, 0, 0)
      scene.add(mesh)
      splat = mesh

      try {
        await mesh.initialized
        if (disposed) return
        applySize()

        // Posicionar cámara al centro del splat a altura de ojo (~1.6m relativo)
        mesh.updateMatrixWorld(true)
        const box = mesh.getBoundingBox(true)
        if (box && !box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
          const size = box.getSize(new THREE.Vector3())
          const eyeHeight = size.y * 0.1 // 10% desde el centro = altura de ojo aproximada
          camera.position.set(center.x, center.y + eyeHeight, center.z)
          // Mirar ligeramente hacia adentro del cuarto
          camera.lookAt(center.x, center.y + eyeHeight, center.z - size.z * 0.3)
          camera.near = 0.001
          camera.far = Math.max(size.x, size.y, size.z) * 20
          camera.updateProjectionMatrix()
        }
        setStatus('ready')
      } catch (err) {
        console.error('[SplatViewer] error:', err)
        if (!disposed) setStatus('error')
        return
      }

      // ── Controles FPS estilo Minecraft ──────────────────────────────────────
      const euler = new THREE.Euler(0, 0, 0, 'YXZ')
      // Extraer ángulos iniciales de la cámara
      euler.setFromQuaternion(camera.quaternion)

      const onMouseMove = (e: MouseEvent) => {
        if (!camera || document.pointerLockElement !== renderer!.domElement) return
        const sens = 0.002
        euler.y -= e.movementX * sens
        euler.x -= e.movementY * sens
        euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.x))
        camera.quaternion.setFromEuler(euler)
      }

      const onKeyDown = (e: KeyboardEvent) => { keys[e.code] = true }
      const onKeyUp   = (e: KeyboardEvent) => { keys[e.code] = false }

      const onLockChange = () => {
        const isLocked = document.pointerLockElement === renderer!.domElement
        setLocked(isLocked)
      }

      // Scroll = zoom (avanzar/retroceder)
      const onWheel = (e: WheelEvent) => {
        if (!camera) return
        const dir = new THREE.Vector3()
        camera.getWorldDirection(dir)
        camera.position.addScaledVector(dir, -e.deltaY * 0.01)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('keydown', onKeyDown)
      document.addEventListener('keyup', onKeyUp)
      document.addEventListener('pointerlockchange', onLockChange)
      renderer.domElement.addEventListener('wheel', onWheel, { passive: true })
      renderer.domElement.addEventListener('click', () => {
        renderer?.domElement.requestPointerLock()
      })

      const dir    = new THREE.Vector3()
      const right  = new THREE.Vector3()
      const up     = new THREE.Vector3(0, 1, 0)
      const SPEED  = 0.02

      const animate = () => {
        raf = requestAnimationFrame(animate)
        if (!camera) return

        // Movimiento WASD + QE
        camera.getWorldDirection(dir)
        dir.y = 0
        dir.normalize()
        right.crossVectors(dir, up).normalize()

        if (keys['KeyW'] || keys['ArrowUp'])    camera.position.addScaledVector(dir,  SPEED)
        if (keys['KeyS'] || keys['ArrowDown'])  camera.position.addScaledVector(dir, -SPEED)
        if (keys['KeyA'] || keys['ArrowLeft'])  camera.position.addScaledVector(right,-SPEED)
        if (keys['KeyD'] || keys['ArrowRight']) camera.position.addScaledVector(right, SPEED)
        if (keys['KeyE'] || keys['Space'])      camera.position.y += SPEED
        if (keys['KeyQ'])                        camera.position.y -= SPEED

        renderer!.render(scene, camera)
      }
      animate()

      // Cleanup de eventos
      const cleanupEvents = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('keyup', onKeyUp)
        document.removeEventListener('pointerlockchange', onLockChange)
        renderer?.domElement.removeEventListener('wheel', onWheel)
      }
      ;(container as HTMLDivElement & { _cleanupEvents?: () => void })._cleanupEvents = cleanupEvents
    }

    init().catch((err) => {
      console.error('[SplatViewer] init falló:', err)
      if (!disposed) setStatus('error')
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      ;(container as HTMLDivElement & { _cleanupEvents?: () => void })._cleanupEvents?.()
      splat?.dispose()
      if (renderer) {
        renderer.dispose()
        renderer.domElement.parentNode?.removeChild(renderer.domElement)
      }
    }
  }, [url])

  return (
    <div className={className ?? 'relative w-full h-full'} style={{ touchAction: 'none' }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Overlay de carga */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Cargando tour 3D...</p>
          </div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400">
          <p className="text-sm">No se pudo cargar el tour 3D.</p>
        </div>
      )}

      {/* Instrucciones — solo cuando cargó pero cursor no está bloqueado */}
      {status === 'ready' && !locked && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={requestLock}
        >
          <div className="bg-black/60 backdrop-blur-sm text-white px-6 py-4 rounded-xl text-center select-none">
            <p className="font-semibold text-base mb-1">Haz clic para navegar</p>
            <p className="text-gray-300 text-xs">WASD · mouse mira · Q/E sube/baja · ESC para salir</p>
          </div>
        </div>
      )}

      {/* Mira crosshair — cuando cursor está bloqueado */}
      {locked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-4 h-4 relative opacity-70">
            <div className="absolute top-1/2 left-0 right-0 h-px bg-white" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white" />
          </div>
        </div>
      )}
    </div>
  )
}
