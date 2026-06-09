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
