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
