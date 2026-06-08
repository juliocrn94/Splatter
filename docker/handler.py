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
    project_id   = inp["project_id"]
    video_url    = inp["video_url"]       # presigned GET URL para descargar el video
    ply_put_url  = inp["ply_upload_url"]  # presigned PUT URL para subir el .ply
    spz_put_url  = inp.get("spz_upload_url")
    quality      = inp.get("quality", "standard")

    job_dir = os.path.join(WORKDIR, project_id)
    os.makedirs(job_dir, exist_ok=True)

    video_path = os.path.join(job_dir, "video.mp4")
    ply_path   = os.path.join(job_dir, f"{project_id}.ply")
    spz_path   = os.path.join(job_dir, f"{project_id}.spz")

    try:
        # 1. Descargar video desde R2
        print(f"[{project_id}] Descargando video...")
        download_video(video_url, video_path)

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
        if spz_put_url and os.path.exists(spz_path):
            print(f"[{project_id}] Subiendo .spz a R2...")
            upload_file(spz_path, spz_put_url)

        print(f"[{project_id}] Pipeline completado con éxito")
        return {"ok": True, "project_id": project_id}

    except subprocess.TimeoutExpired:
        return {"error": "El procesamiento tardó más de 2 horas.", "code": "TIMEOUT"}
    except Exception as e:
        return {"error": str(e), "code": "UNKNOWN"}
    finally:
        # Limpiar archivos temporales
        subprocess.run(["rm", "-rf", job_dir], check=False)


runpod.serverless.start({"handler": handler})
