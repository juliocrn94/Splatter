import runpod
import subprocess
import os
import shutil
import requests

WORKDIR = "/tmp/jobs"
MIN_PLY_BYTES = 1 * 1024 * 1024   # un .ply válido pesa al menos 1MB
MIN_FREE_BYTES = 5 * 1024 ** 3    # exigir 5GB libres antes de descargar


def check_disk_space() -> None:
    free = shutil.disk_usage("/tmp").free
    if free < MIN_FREE_BYTES:
        raise RuntimeError(f"DISK_FULL: solo {free // 1024 // 1024}MB libres en /tmp")


def download_video(video_url: str, dest: str) -> None:
    r = requests.get(video_url, stream=True, timeout=600)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
            f.write(chunk)


def upload_file(file_path: str, upload_url: str) -> None:
    """Sube a R2 via presigned PUT URL.

    R2 exige Content-Length explícito en presigned PUTs — sin él responde
    411 Length Required o cuelga con chunked transfer encoding.
    """
    file_size = os.path.getsize(file_path)
    with open(file_path, "rb") as f:
        r = requests.put(
            upload_url,
            data=f,
            headers={
                "Content-Length": str(file_size),
                "Content-Type": "application/octet-stream",
            },
            timeout=900,  # 15 min — .ply son 300-800MB
        )
        r.raise_for_status()


def parse_error_code(stderr: str) -> str:
    s = stderr.lower()
    if "colmap no pudo reconstruir" in s or "colmap failed" in s:
        return "COLMAP_FAILED"
    if "out of memory" in s or "oom" in s or "killed" in s:
        return "OOM"
    if "corrupt" in s or "invalid data" in s:
        return "FFMPEG_FAILED"
    return "PIPELINE_FAILED"


def handler(job):
    inp = job["input"]
    project_id  = inp["project_id"]
    video_url   = inp.get("video_url")
    video_urls  = inp.get("video_urls")
    ply_put_url = inp["ply_upload_url"]
    spz_put_url = inp.get("spz_upload_url")
    quality            = inp.get("quality", "standard")
    feature_extractor  = inp.get("feature_extractor", "sift")
    trainer            = inp.get("trainer", "opensplat")

    # Si llega 'superpoint' pero hloc no está instalado, caer a sift con aviso.
    # Esto evita que el worker crashee cuando el UI envía superpoint a un endpoint sin hloc.
    import shutil as _shutil
    if feature_extractor == "superpoint" and not _shutil.which("hloc") and not os.path.exists("/opt/hloc"):
        print(f"[{inp.get('project_id','?')}] AVISO: superpoint solicitado pero hloc no instalado — usando sift")
        feature_extractor = "sift"

    if not video_url and not video_urls:
        raise ValueError("PIPELINE_FAILED: Se requiere video_url o video_urls")

    # Multi-video aún no soportado en el pipeline de shell — bloquear silenciosamente
    all_video_urls = [video_url] if video_url else video_urls[:1]

    job_dir  = os.path.join(WORKDIR, project_id)
    ply_path = os.path.join(job_dir, f"{project_id}.ply")
    spz_path = os.path.join(job_dir, f"{project_id}.spz")

    check_disk_space()
    os.makedirs(job_dir, exist_ok=True)
    total_video_bytes = 0

    try:
        # 1. Descargar video(s)
        video_paths = []
        for i, url in enumerate(all_video_urls):
            vpath = os.path.join(job_dir, f"video_{i}.mp4")
            print(f"[{project_id}] Descargando video {i+1}/{len(all_video_urls)}...")
            download_video(url, vpath)
            total_video_bytes += os.path.getsize(vpath)
            video_paths.append(vpath)

        video_path = video_paths[0]

        # 2. Pipeline: FFmpeg → COLMAP → OpenSplat → .ply + .spz
        print(f"[{project_id}] Iniciando pipeline (quality={quality})...")
        result = subprocess.run(
            ["/opt/process_splat.sh", video_path, project_id, quality, feature_extractor, trainer],
            capture_output=True,
            text=True,
            cwd=job_dir,
            timeout=7200,
        )

        if result.returncode != 0:
            print(f"[{project_id}] Pipeline stderr:\n{result.stderr}")
            code = parse_error_code(result.stderr)
            raise RuntimeError(f"{code}: {result.stderr[-800:]}")

        print(f"[{project_id}] Pipeline stdout:\n{result.stdout[-2000:]}")

        # 3. Validar tamaño del .ply antes de subir
        if not os.path.exists(ply_path):
            raise RuntimeError("COLMAP_FAILED: No se generó el archivo .ply")

        ply_size = os.path.getsize(ply_path)
        if ply_size < MIN_PLY_BYTES:
            raise RuntimeError(
                f"COLMAP_FAILED: .ply inválido — {ply_size} bytes "
                f"(OpenSplat puede haber fallado silenciosamente)"
            )

        print(f"[{project_id}] Subiendo .ply ({ply_size // 1024 // 1024}MB)...")
        upload_file(ply_path, ply_put_url)
        ply_bytes = ply_size

        # 4. Subir .spz si fue generado
        spz_bytes = 0
        if spz_put_url:
            if os.path.exists(spz_path) and os.path.getsize(spz_path) > 0:
                spz_size = os.path.getsize(spz_path)
                print(f"[{project_id}] Subiendo .spz ({spz_size // 1024 // 1024}MB)...")
                upload_file(spz_path, spz_put_url)
                spz_bytes = spz_size
            else:
                print(f"[{project_id}] AVISO: .spz no generado — ply_to_spz puede no estar instalado")

        print(f"[{project_id}] Listo. ply={ply_bytes // 1024 // 1024}MB spz={spz_bytes // 1024 // 1024}MB")
        return {
            "ok":               True,
            "project_id":       project_id,
            "video_size_bytes": total_video_bytes,
            "ply_size_bytes":   ply_bytes,
            "spz_size_bytes":   spz_bytes,
        }

    except subprocess.TimeoutExpired as exc:
        # Matar el proceso hijo para que libere disco y GPU antes del finally
        print(f"[{project_id}] TIMEOUT: matando proceso...")
        if exc.process:
            exc.process.kill()
            exc.process.wait()
        raise RuntimeError("TIMEOUT: El procesamiento tardó más de 2 horas")

    finally:
        subprocess.run(["rm", "-rf", job_dir], check=False)


runpod.serverless.start({"handler": handler})
