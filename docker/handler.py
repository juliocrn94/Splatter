import runpod
import subprocess
import os
import requests

WORKDIR = "/tmp/jobs"


def download_video(video_url: str, dest: str) -> None:
    """Descarga el video desde la presigned URL de R2."""
    r = requests.get(video_url, stream=True, timeout=300)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
            f.write(chunk)


def upload_file(file_path: str, upload_url: str) -> None:
    """Sube el archivo a R2 via presigned PUT URL."""
    with open(file_path, "rb") as f:
        r = requests.put(upload_url, data=f, timeout=300)
        r.raise_for_status()


def handler(job):
    inp = job["input"]
    project_id   = inp.get("project_id") or inp["project_id"]
    video_url    = inp.get("video_url")    # presigned GET URL (video principal)
    video_urls   = inp.get("video_urls")   # lista para multi-video (2B)
    ply_put_url  = inp["ply_upload_url"]   # presigned PUT URL para subir el .ply
    spz_put_url  = inp.get("spz_upload_url")
    quality      = inp.get("quality", "standard")

    if not video_url and not video_urls:
        return {"error": "Se requiere video_url o video_urls", "code": "MISSING_VIDEO"}

    # Normalizar: usar video_urls si viene, sino lista con el video_url principal
    all_video_urls = video_urls if video_urls else [video_url]

    job_dir = os.path.join(WORKDIR, project_id)
    os.makedirs(job_dir, exist_ok=True)

    ply_path   = os.path.join(job_dir, f"{project_id}.ply")
    spz_path   = os.path.join(job_dir, f"{project_id}.spz")

    total_video_bytes = 0

    try:
        # 1. Descargar todos los videos desde R2
        video_paths = []
        for i, url in enumerate(all_video_urls):
            vpath = os.path.join(job_dir, f"video_{i}.mp4")
            print(f"[{project_id}] Descargando video {i+1}/{len(all_video_urls)}...")
            download_video(url, vpath)
            total_video_bytes += os.path.getsize(vpath)
            video_paths.append(vpath)

        # El pipeline acepta el primer video como argumento principal
        # (process_splat.sh se actualizará para multi-video en el futuro)
        video_path = video_paths[0]

        # 2. Correr el pipeline: FFmpeg → COLMAP → OpenSplat → .spz
        print(f"[{project_id}] Iniciando pipeline (quality={quality})...")
        result = subprocess.run(
            ["/opt/process_splat.sh", video_path, project_id, quality],
            capture_output=True,
            text=True,
            cwd=job_dir,
            timeout=7200,  # 2 horas máximo
        )

        if result.returncode != 0:
            print(f"[{project_id}] Pipeline stderr:\n{result.stderr[-1000:]}")
            return {"error": result.stderr[-500:], "code": "PIPELINE_FAILED"}

        # 3. Subir .ply a R2
        if not os.path.exists(ply_path):
            return {"error": "No se generó el archivo .ply", "code": "COLMAP_FAILED"}

        print(f"[{project_id}] Subiendo .ply a R2...")
        upload_file(ply_path, ply_put_url)

        # 4. Subir .spz a R2 si existe
        spz_bytes = 0
        if spz_put_url and os.path.exists(spz_path):
            print(f"[{project_id}] Subiendo .spz a R2...")
            upload_file(spz_path, spz_put_url)
            spz_bytes = os.path.getsize(spz_path)

        ply_bytes = os.path.getsize(ply_path) if os.path.exists(ply_path) else 0

        print(f"[{project_id}] Pipeline completado con éxito")
        return {
            "ok": True,
            "project_id": project_id,
            # Métricas para el estimador dinámico (2D)
            "video_size_bytes":  total_video_bytes,
            "ply_size_bytes":    ply_bytes,
            "spz_size_bytes":    spz_bytes,
        }

    except subprocess.TimeoutExpired:
        return {"error": "El procesamiento tardó más de 2 horas.", "code": "TIMEOUT"}
    except Exception as e:
        return {"error": str(e), "code": "UNKNOWN"}
    finally:
        # Limpiar archivos temporales
        subprocess.run(["rm", "-rf", job_dir], check=False)


runpod.serverless.start({"handler": handler})
