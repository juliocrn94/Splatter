# Splatter — Contexto del Proyecto

## Qué es

Servicio de captura y entrega de tours 3D fotorrealistas (Gaussian Splatting) para desarrolladoras inmobiliarias en preventa en CDMX. El operador graba un video de la propiedad, el sistema lo procesa en un tour 3D interactivo, y entrega un link compartible al cliente.

**Stack principal:** Next.js 16 (App Router) + Supabase + Cloudflare R2 + RunPod serverless + Vercel

## Arquitectura

```
BROWSER (operador) — protegido por middleware de contraseña
    │
    ├── GET /api/presign → URL firmada R2 → browser sube video DIRECTO a R2
    ├── POST /api/jobs   → dispara RunPod serverless (pasa presigned upload URLs, no credenciales)
    ├── POST /api/projects/[id]/deliver → aprueba proyecto (server-side)
    ├── POST /api/projects/[id]/retry   → reinicia proyecto fallido (server-side)
    │
RUNPOD (GPU cloud, ~$0.20/proyecto)
    │   FFmpeg → COLMAP → OpenSplat → .ply + .spz
    │   Sube outputs vía presigned PUT URLs (sin credenciales R2 en el payload)
    │
    └── POST /api/webhook/runpod → actualiza Supabase (solo status, keys ya guardadas)
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
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # antes: ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
NEXT_PUBLIC_R2_PUBLIC_URL=   # IMPORTANTE: prefijo NEXT_PUBLIC_ requerido (usado en el cliente)

# RunPod
RUNPOD_API_KEY=
RUNPOD_ENDPOINT_ID=
RUNPOD_WEBHOOK_SECRET=

# App
NEXT_PUBLIC_APP_URL=

# Autenticación del operador
OPERATOR_PASSWORD=   # contraseña para acceder al dashboard — generar con: openssl rand -base64 24
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
  ply_r2_key    TEXT,   -- guardado al despachar el job (antes del webhook)
  spz_r2_key    TEXT,   -- guardado al despachar el job (antes del webhook)
  runpod_job_id TEXT,
  quality       TEXT DEFAULT 'standard',
  processing_started_at TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  notes         TEXT
);
ALTER TABLE projects REPLICA IDENTITY FULL;
```

**RLS activo** — anon key (cliente) solo puede leer. Escrituras solo via service role (API routes).

## Estado del proyecto (state machine)

```
uploading → processing → reviewing → delivered
               ↓              ↓
            failed         reprocessing → reviewing → delivered
```

Transiciones de estado controladas server-side:
- `uploading → processing`: `/api/jobs` (dispatch inicial)
- `reviewing → reprocessing`: `/api/jobs` con `quality: 'hq'`
- `reviewing → delivered`: `/api/projects/[id]/deliver`
- `failed → uploading`: `/api/projects/[id]/retry`
- `processing/reprocessing → failed`: webhook de RunPod

## Rutas

| Ruta | Auth | Descripción |
|---|---|---|
| `/login` | pública | Login del operador |
| `/` | operador | Lista de proyectos (dashboard) |
| `/nuevo` | operador | Crear proyecto + upload video |
| `/proyecto/[id]` | operador | Progreso del procesamiento |
| `/proyecto/[id]/revisar` | operador | QC: ver .spz, Aprobar o Reprocesar |
| `/proyecto/[id]/entrega` | operador | Link final copiable |
| `/tour/[slug]` | pública | Tour público con Spark viewer (mobile) |
| `/viewer` | operador | Viewer interno supersplat (cargado via iframe desde revisar) |

## API routes

| Ruta | Descripción |
|---|---|
| `POST /api/presign` | Genera presigned URL para upload directo a R2 |
| `POST /api/jobs` | Despacha job en RunPod + guarda output keys + actualiza status |
| `POST /api/webhook/runpod` | Recibe resultado de RunPod, actualiza status (sin credenciales) |
| `POST /api/projects/[id]/deliver` | Aprueba un proyecto en `reviewing` |
| `POST /api/projects/[id]/retry` | Reinicia un proyecto `failed` a `uploading` |
| `POST /api/auth/login` | Valida contraseña y setea cookie `operator_token` |

## Formatos de archivo

- **`.ply`** — maestro (300-800MB). Clave: `results/{projectId}.ply`. Solo en R2.
- **`.spz`** — entrega (15-30MB). Clave: `results/{projectId}.spz`. Todos los viewers lo usan.
- **videos** — Clave: `videos/{uuid}.{ext}`. Input del pipeline.

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
7. RunPod recibe presigned upload URLs (no credenciales R2) — credenciales nunca salen del servidor
8. Output keys (`ply_r2_key`, `spz_r2_key`) guardadas al despachar el job, no al recibir el webhook
9. Auth de operador via cookie httpOnly + middleware — sin Supabase Auth para simplicidad del MVP

## Estado del build

### Lo que está construido y funciona

| Archivo | Qué hace |
|---|---|
| `src/middleware.ts` | Protege rutas del operador con contraseña (cookie httpOnly) |
| `src/app/login/page.tsx` | Login del operador |
| `src/app/page.tsx` | Lista de proyectos con Supabase Realtime |
| `src/app/nuevo/page.tsx` | Upload con drag & drop, warning 2-4GB, presigned URL |
| `src/app/proyecto/[id]/page.tsx` | Progreso con stepper, tips rotativos, estado Failed + Reintentar |
| `src/app/proyecto/[id]/revisar/page.tsx` | QC: supersplat-viewer iframe + Aprobar + modal Reprocesar HQ |
| `src/app/proyecto/[id]/entrega/page.tsx` | Link copiable del tour |
| `src/app/tour/[slug]/page.tsx` | Server component — carga datos del proyecto |
| `src/app/tour/[slug]/TourViewer.tsx` | Spark viewer para mobile (carga .spz) |
| `src/app/viewer/page.tsx` | Viewer interno con @playcanvas/supersplat-viewer (valida origen R2) |
| `src/app/api/presign/route.ts` | Genera presigned URL para upload (extensión sanitizada) |
| `src/app/api/jobs/route.ts` | Despacha job RunPod con presigned output URLs + status guard |
| `src/app/api/webhook/route.ts` | Recibe resultado RunPod, valida job ID, actualiza status |
| `src/app/api/projects/[id]/deliver/route.ts` | Aprobar proyecto (server-side, valida estado) |
| `src/app/api/projects/[id]/retry/route.ts` | Reintentar proyecto fallido (server-side) |
| `src/app/api/auth/login/route.ts` | Autenticación del operador |
| `src/lib/supabase.ts` | Cliente Supabase + tipos + validación de env vars al startup |
| `src/lib/r2.ts` | Presigned URLs + límites de upload + validación de env vars al startup |
| `supabase/schema.sql` | Tabla + RLS + índices + watchdog_stuck_jobs() + pg_cron |
| `scripts/process_splat.sh` | Pipeline CLI: FFmpeg → COLMAP → OpenSplat → .ply + .spz |
| `cloudflare/r2-cors.json` | Config CORS para el bucket R2 (GET + HEAD + PUT) |

### Estado de servicios externos

| Servicio | Estado | Notas |
|---|---|---|
| Supabase | ✅ Listo | Schema corrido, RLS activo, pg_cron watchdog activo |
| Cloudflare R2 | ⏳ Pendiente | Crear bucket + aplicar `cloudflare/r2-cors.json` + API token |
| RunPod | ⏳ Pendiente | Crear Docker image + endpoint serverless; actualizar worker para usar presigned PUT URLs |
| Vercel | ⏳ Pendiente | Deploy final + env vars (incluye `NEXT_PUBLIC_R2_PUBLIC_URL` y `OPERATOR_PASSWORD`) |

### Notas sobre Supabase API keys (nuevo sistema 2026)

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → usar la **Publishable key** (`sb_publishable_...`)
- `SUPABASE_SERVICE_ROLE_KEY` → usar la **Secret key** (`sb_secret_...`)
- `NEXT_PUBLIC_SUPABASE_URL` → copiar del botón **Connect** (`https://xxxx.supabase.co`)

### Pendiente

- **RunPod worker**: actualizar `process_splat.sh` para usar `ply_upload_url` / `spz_upload_url` en lugar de credenciales R2 directas
- **TourViewer.tsx**: importa Spark desde CDN (`cdn.jsdelivr.net`) como workaround — cambiar a npm cuando `@sparkxr/spark` esté disponible
- **T15** ✅ Resuelto — `@playcanvas/supersplat-viewer` es MIT License, libre para uso comercial

### Para arrancar en local

```bash
cp .env.local.example .env.local
# Rellenar: SUPABASE_URL, keys, R2_*, RUNPOD_*, NEXT_PUBLIC_APP_URL, OPERATOR_PASSWORD
npm install
npm run dev
# Abre http://localhost:3000/login
```

**Prerequisitos:** correr `supabase/schema.sql` en el SQL Editor de Supabase antes del primer uso (incluye RLS + pg_cron).

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
