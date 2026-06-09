-- Splatter — schema inicial
-- Correr en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS projects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  name                  TEXT NOT NULL,
  client_name           TEXT NOT NULL,
  slug                  TEXT UNIQUE NOT NULL,
  status                TEXT NOT NULL DEFAULT 'uploading'
                        CHECK (status IN ('uploading','processing','reviewing','reprocessing','delivered','failed')),
  error_message         TEXT,
  video_r2_key          TEXT,
  ply_r2_key            TEXT,
  spz_r2_key            TEXT,
  runpod_job_id         TEXT,
  quality               TEXT NOT NULL DEFAULT 'standard'
                        CHECK (quality IN ('standard','hq')),
  processing_started_at TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  notes                 TEXT
);

-- Habilitar Realtime
ALTER TABLE projects REPLICA IDENTITY FULL;

-- Row Level Security:
-- - anon puede leer (necesario para las lecturas client-side y Realtime)
-- - anon NO puede escribir (las mutaciones van por API routes con service role)
-- - service role tiene acceso completo
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read only" ON projects
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "service role full access" ON projects
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Índices
CREATE INDEX projects_status_idx ON projects (status);
CREATE INDEX projects_slug_idx   ON projects (slug);

-- Dead-man watchdog: marca como failed proyectos en processing >2h
-- Correr como Supabase cron job cada 15 minutos
CREATE OR REPLACE FUNCTION watchdog_stuck_jobs()
RETURNS void AS $$
  UPDATE projects
  SET
    status        = 'failed',
    error_message = 'El procesamiento tardó más de 2 horas. Intenta con un video más corto o mejor iluminado.'
  WHERE
    status IN ('processing', 'reprocessing')
    AND processing_started_at < NOW() - INTERVAL '2 hours';
$$ LANGUAGE sql;

-- Registrar el watchdog como cron job cada 15 minutos.
-- Requiere pg_cron habilitado en Supabase (Database → Extensions → pg_cron).
-- Correr UNA VEZ manualmente en el SQL Editor después de habilitar la extensión:
SELECT cron.schedule(
  'watchdog-stuck-jobs',        -- nombre del job (único)
  '*/15 * * * *',               -- cada 15 minutos
  'SELECT watchdog_stuck_jobs()'
);

-- Migración: agregar project_code y city si no existen
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_code TEXT UNIQUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT 'CDMX';
CREATE INDEX IF NOT EXISTS projects_project_code_idx ON projects (project_code);

-- Design review additions
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

-- Soft delete: los proyectos nunca se borran físicamente
-- El project_code queda en la DB para siempre — el contador es monotónico
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  DROP CONSTRAINT IF EXISTS projects_status_check,
  ADD CONSTRAINT projects_status_check CHECK (
    status IN ('uploading','processing','reviewing','reprocessing','delivered','failed','deleted')
  );

-- Índice para filtrar deleted eficientemente
CREATE INDEX IF NOT EXISTS projects_deleted_at_idx ON projects (deleted_at) WHERE deleted_at IS NULL;

-- ─── Fase 2B: video_r2_keys — array de keys para multi-video upload ───────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS video_r2_keys JSONB NOT NULL DEFAULT '[]';

-- ─── Fase 2D: métricas de procesamiento para estimador dinámico ───────────────
CREATE TABLE IF NOT EXISTS processing_metrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID REFERENCES projects(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  processing_duration_s INTEGER,      -- segundos totales de GPU
  video_size_bytes      BIGINT,        -- tamaño del video original
  frame_count           INTEGER,       -- frames extraídos por FFmpeg
  quality               TEXT,          -- 'standard' | 'hq'
  ply_size_bytes        BIGINT,        -- tamaño del .ply generado
  spz_size_bytes        BIGINT         -- tamaño del .spz generado
);

-- Índices para la query del estimador (últimas 5 por fecha)
CREATE INDEX IF NOT EXISTS processing_metrics_created_at_idx
  ON processing_metrics (created_at DESC);
CREATE INDEX IF NOT EXISTS processing_metrics_project_id_idx
  ON processing_metrics (project_id);

-- RLS: anon puede leer (dashboard usa anon key)
ALTER TABLE processing_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read only" ON processing_metrics
  FOR SELECT TO anon USING (true);

CREATE POLICY "service role full access" ON processing_metrics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Seguridad: RLS más restrictivo ──────────────────────────────────────────
-- processing_metrics no necesita ser pública — solo la lee el API route server-side
-- Reemplazar la política anon permisiva:
-- DROP POLICY "anon read only" ON processing_metrics;
-- (El dashboard lee processing_metrics server-side via supabaseAdmin en /api/jobs)

-- TODO (cuando el dashboard migre a server components):
-- La política "anon read only" ON projects con USING(true) expone todos los proyectos
-- (nombres, teléfonos, keys de R2) a cualquier cliente con la anon key.
-- Migración pendiente:
--
--   DROP POLICY "anon read only" ON projects;
--   CREATE POLICY "anon read delivered only" ON projects
--     FOR SELECT TO anon
--     USING (status = 'delivered' AND deleted_at IS NULL);
--
-- Requiere mover el dashboard y proyecto/[id]/page.tsx a server components
-- que usen supabaseAdmin() en lugar del cliente anon.
-- El tour/[slug]/page.tsx ya usa supabaseAdmin() y no requiere la política anon.
