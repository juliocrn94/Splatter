import { useState } from 'react'

export interface UploadResult {
  key: string
}

export interface UploadState {
  uploading: boolean
  progress: number  // 0-100
  error: string
}

export function useVideoUpload() {
  const [state, setState] = useState<UploadState>({ uploading: false, progress: 0, error: '' })

  async function upload(file: File): Promise<UploadResult> {
    setState({ uploading: true, progress: 0, error: '' })

    const presignRes = await fetch('/api/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }),
    })

    if (!presignRes.ok) {
      const { error: msg } = await presignRes.json()
      setState({ uploading: false, progress: 0, error: msg ?? 'Error al generar URL de subida' })
      throw new Error(msg)
    }

    const { url, key } = await presignRes.json()

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) {
          setState(s => ({ ...s, progress: Math.round((ev.loaded / ev.total) * 100) }))
        }
      })
      xhr.open('PUT', url)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.onload = () => {
        if (xhr.status < 300) resolve()
        else reject(new Error('Error al subir el video'))
      }
      xhr.onerror = () => reject(new Error('Error de red al subir el video'))
      xhr.send(file)
    })

    setState({ uploading: false, progress: 100, error: '' })
    return { key }
  }

  function reset() {
    setState({ uploading: false, progress: 0, error: '' })
  }

  return { ...state, upload, reset }
}
