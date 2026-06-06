# Splatter — Contexto del Proyecto

## Qué es

Servicio de captura y entrega de tours 3D fotorrealistas (Gaussian Splatting) para desarrolladoras inmobiliarias en preventa en CDMX. El operador graba un video de la propiedad, el sistema lo procesa en un tour 3D interactivo, y entrega un link compartible al cliente.

**Stack principal:** Next.js 14 (App Router) + Supabase + Cloudflare R2 + RunPod serverless + Vercel

## Arquitectura

```
BROWSER (operador)
    │
    ├── GET /api/presign → URL firmada R2 → browser sube video DIRECTO a R2
    ├── POST /api/jobs   → dispara RunPod serverless
    │
RUNPOD (GPU cloud, ~$0.20/proyecto)
    │   FFmpeg → COLMAP → OpenSplat → .ply + .spz
    │
    └── POST /api/webhook/runpod → actualiza Supabase
                                 → Supabase Realtime push al browser

VIEWERS
    ├── Dashboard (operador): @playcanvas/supersplat-viewer — carga .spz desde R2
    └── Cliente (mobile):     Spark (World Labs) — carga .spz desde R2
```

## Stack de servicios

| Servicio | Uso | Costo |
|---|---|---|
| Vercel | Deploy frontend + API routes | $0 |
| Supabase | Postgres + Realtime WebSocket | $0 free tier |
| Cloudflare R2 | Storage videos + .ply + .spz | $0 (10GB gratis) |
| RunPod serverless | GPU processing (COLMAP + OpenSplat) | ~$0.20/proyecto |

## Variables de entorno requeridas

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# RunPod
RUNPOD_API_KEY=
RUNPOD_ENDPOINT_ID=
RUNPOD_WEBHOOK_SECRET=

# App
NEXT_PUBLIC_APP_URL=
```

## Schema de base de datos (Supabase)

```sql
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  name        TEXT NOT NULL,
  client_name TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'uploading',
  -- estados: uploading | processing | reviewing | reprocessing | delivered | failed
  error_message TEXT,
  video_r2_key  TEXT,
  ply_r2_key    TEXT,
  spz_r2_key    TEXT,
  runpod_job_id TEXT,
  quality       TEXT DEFAULT 'standard',
  processing_started_at TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  notes         TEXT
);
ALTER TABLE projects REPLICA IDENTITY FULL;
```

## Estado del proyecto (state machine)

```
uploading → processing → reviewing → delivered
               ↓              ↓
            failed         reprocessing → reviewing → delivered
```

## Rutas

| Ruta | Descripción |
|---|---|
| `/` | Lista de proyectos (dashboard operador) |
| `/nuevo` | Crear proyecto + upload video |
| `/proyecto/[id]` | Progreso del procesamiento |
| `/proyecto/[id]/revisar` | QC: ver .spz, Aprobar o Reprocesar |
| `/proyecto/[id]/entrega` | Link final |
| `/tour/[slug]` | Tour público con Spark viewer (mobile) |

## Formatos de archivo

- **`.ply`** — maestro (300-800MB). Solo en R2, nunca se muestra al usuario.
- **`.spz`** — entrega (15-30MB). 10x más pequeño, mobile-optimizado. Todos los viewers lo usan.

## Límites de upload

- `< 2GB` — upload directo sin aviso
- `2-4GB` — warning con estimación de tiempo y costo, usuario confirma
- `> 4GB` — bloqueado

## Decisiones de arquitectura

1. Sin BullMQ/Redis/Railway — RunPod webhook nativo es suficiente
2. Supabase Realtime, no polling
3. Upload directo a R2 con presigned URL (evita límite 4.5MB de Vercel)
4. COLMAP vocab_tree_matcher — exhaustive_matcher hace OOM con 400+ imágenes
5. Path-based routing `splatter.mx/tour/slug` — subdominios del cliente = DNS pain
6. Self-hosted viewers: supersplat-viewer (npm) para dashboard, Spark para mobile

## Estado del build (commit 167805e)

### Lo que está construido y funciona
| Archivo | Qué hace |
|---|---|
| `src/app/page.tsx` | Lista de proyectos con Supabase Realtime |
| `src/app/nuevo/page.tsx` | Upload con drag & drop, warning 2-4GB, presigned URL |
| `src/app/proyecto/[id]/page.tsx` | Progreso con stepper, tips rotativos, estado Failed + Reintentar |
| `src/app/proyecto/[id]/revisar/page.tsx` | QC: supersplat-viewer iframe + Aprobar + modal Reprocesar HQ |
| `src/app/proyecto/[id]/entrega/page.tsx` | Link copiable del tour |
| `src/app/tour/[slug]/page.tsx` | Server component — carga datos del proyecto |
| `src/app/tour/[slug]/TourViewer.tsx` | Spark viewer para mobile (carga .spz) |
| `src/app/viewer/page.tsx` | Viewer interno con @playcanvas/supersplat-viewer |
| `src/app/api/presign/route.ts` | Genera presigned URL para upload directo a R2 |
| `src/app/api/jobs/route.ts` | Dispara job en RunPod serverless |
| `src/app/api/webhook/route.ts` | Recibe resultado de RunPod, actualiza Supabase |
| `src/lib/supabase.ts` | Cliente Supabase + tipos + STATUS_LABELS/COLORS |
| `src/lib/r2.ts` | Presigned URLs + límites de upload + getPublicUrl |
| `supabase/schema.sql` | Tabla projects + índices + función watchdog_stuck_jobs() |
| `scripts/process_splat.sh` | Pipeline CLI: FFmpeg → COLMAP → OpenSplat → .ply + .spz |

### Pendiente (del eng review)
- **T13** `scripts/process_splat.sh` — reemplazar filtro blur por tamaño de archivo → usar `ffmpeg -vf "idet"` o varianza de Laplaciano. El filtro actual (`ls -lS` → borrar 5% más pequeños) es incorrecto, tamaño de archivo no correlaciona con nitidez.
- **T14** Supabase cron — registrar `watchdog_stuck_jobs()` como pg_cron job cada 15 min en el SQL editor de Supabase: `SELECT cron.schedule('watchdog', '*/15 * * * *', 'SELECT watchdog_stuck_jobs()');`
- **T15** Verificar licencia `@playcanvas/supersplat-viewer` para uso comercial antes de lanzar.
- **CORS R2** — configurar en Cloudflare dashboard para que el viewer cargue .spz desde el browser (Origins: `*` o dominio específico, Methods: GET).
- **TourViewer.tsx** importa Spark desde CDN (`cdn.jsdelivr.net`) como workaround. Cuando el paquete npm `@sparkxr/spark` esté disponible, cambiar a import estático.

### Para arrancar en local
```bash
cp .env.local.example .env.local
# Rellenar: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#           R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
#           R2_PUBLIC_URL, RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID, RUNPOD_WEBHOOK_SECRET,
#           NEXT_PUBLIC_APP_URL=http://localhost:3000
npm run dev
```
Correr `supabase/schema.sql` en el SQL Editor de tu proyecto Supabase antes del primer uso.

## Skill routing

- Estrategia → `/plan-ceo-review`
- Arquitectura → `/plan-eng-review`
- Code review → `/code-review`
- Bugs → `/investigate`
- QA → `/qa`
- Ship → `/ship`

## Contexto de negocio

- Cliente objetivo: desarrolladoras pequeñas en CDMX, proyectos en preventa
- Pricing: proyecto 1 gratis, proyectos 2-3 a $300 USD, proyecto 4+ a $600-800 USD
- Costo por proyecto: ~$0.20 USD (RunPod GPU)
- Margen bruto a $300: ~87%
- AI property assistant (Darwin.ai) planificado para mes 3-4 usando Darwin como backend
- Plan completo: `PLAN.md` (gitignored — no commitear)
