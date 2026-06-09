# Handover
_Creado: 2026-06-09_

## Session type
- **Type:** coding
- **Main topic / project:** Splatter — Operator Dashboard para tours 3D fotorrealistas (Gaussian Splatting) para inmobiliarias en CDMX

## Status
- **Current state:** Dashboard MVP deployado en producción (`splatter-two.vercel.app`). Pipeline RunPod funcional. Fixes de seguridad P0/P1 aplicados. Design review completado.
- **Scope covered:** Setup completo (Supabase + R2 + RunPod + Vercel), dashboard operativo con login, upload, progreso, QC, entrega. Auditorías de seguridad/ingeniería/diseño completadas.

## What was done
- Setup completo de servicios: Supabase (schema + sessions + soft delete), Cloudflare R2 (bucket + CORS), RunPod serverless (Docker image compilado con COLMAP + OpenSplat), Vercel deploy
- Pipeline open source: FFmpeg → COLMAP vocab_tree_matcher → OpenSplat → .ply + .spz (sin dependencia de Luma AI)
- Security P0 fixes: rate limiting, session auth en Supabase (no in-memory), requireAuth en todas las API routes, open redirect fix
- Design review 7 passes: DESIGN.md creado, QC sticky bottom mobile, WhatsApp share, tour overlay + lock/unlock, login branding
- Soft delete implementado: proyectos nunca se borran físicamente, project_code nunca se reutiliza
- Version bump automático (A→B→C) cuando se agrega frames o se reprocesa un tour existente
- generateProjectCode fix: usa MAX en lugar de COUNT (evita colisión con códigos existentes)
- Webhook URL fix: `/api/webhook/runpod` → `/api/webhook` (ruta correcta)
- Roadmap documentado en PLAN.md con user stories y criterios de validación

## Open issues / next steps
- **Validar primer proyecto real:** El pipeline está funcionando. Falta subir un video real de una propiedad y confirmar que el tour queda bien para entregarlo a un cliente
- **Correr /autoplan** con el roadmap completo de features pendientes (ver PLAN.md):
  - Fase 2A: Editor integrado de splats
  - Fase 2B: Upload multi-fuente con guía UX
  - Fase 2C: Corrección post-QC (agregar frames a proyecto existente)
  - Fase 2D: Estimador de tiempo basado en datos reales
  - Fase 3A: Portal white-label para clientes (analytics, custom domain)
  - Fase 4: AI property assistant (Darwin.ai)
- **Migration Supabase pendiente de verificar:** Las columnas `contact_phone`, `is_locked`, `deleted_at` y el constraint actualizado deben estar aplicados en producción
- **GitHub auto-deploy bloqueado:** Los commits con email `juliocrn@gmail.com` (sin `94`) quedan blocked en Vercel. Usar `vercel --prod --yes` para deployar manualmente

## How to continue
- Leer `CLAUDE.md` para contexto técnico completo (stack, decisiones de arquitectura, rutas, variables de entorno)
- Leer `PLAN.md` para el roadmap completo con features, user stories y criterios de validación
- Para el `/autoplan`: correrlo con el scope de las Fases 2A-2D + 3A como prioridad
- Primer paso real: capturar una propiedad con el socio, subir video, validar el tour en producción end-to-end
- URL producción: `https://splatter-two.vercel.app` (contraseña: en `.env.local` como `OPERATOR_PASSWORD`)
