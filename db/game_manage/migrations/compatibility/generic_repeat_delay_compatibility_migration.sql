-- =============================================================================
-- Generic repeat delay_ms compatibility (repeat_effect_details + log)
-- =============================================================================
--
-- Idempotent upgrade for existing databases that already have
-- repeat_effect_details. Fresh installs should use schema.sql instead of this
-- file.
--
-- Safe contract:
-- - ADD COLUMN IF NOT EXISTS only
-- - named non-negative CHECKs for main/log (pg_constraint guarded)
-- - no DELETE, DROP, CASCADE, data rewrite, or publish
-- - existing rows receive DEFAULT 0

ALTER TABLE public.repeat_effect_details
    ADD COLUMN IF NOT EXISTS delay_ms int NOT NULL DEFAULT 0;

ALTER TABLE public.repeat_effect_details_log
    ADD COLUMN IF NOT EXISTS delay_ms int NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF to_regclass('public.repeat_effect_details') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'repeat_effect_details'
              AND c.conname = 'ck_repeat_effect_details_delay_ms'
       ) THEN
        ALTER TABLE public.repeat_effect_details
            ADD CONSTRAINT ck_repeat_effect_details_delay_ms
            CHECK (delay_ms >= 0);
    END IF;

    IF to_regclass('public.repeat_effect_details_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'repeat_effect_details_log'
              AND c.conname = 'ck_repeat_effect_details_log_delay_ms'
       ) THEN
        ALTER TABLE public.repeat_effect_details_log
            ADD CONSTRAINT ck_repeat_effect_details_log_delay_ms
            CHECK (delay_ms >= 0);
    END IF;
END $$;
