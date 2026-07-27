-- =============================================================================
-- Generic cast_origin / per_cast_throttle_ms compatibility
-- =============================================================================
--
-- Idempotent upgrade for existing databases that already have the generic
-- combat-data model. Fresh installs should use schema.sql instead of this file.
--
-- Adds:
-- - ability_definitions(+log).cast_origin varchar(16) NULL
--   CHECK NULL OR IN ('champion','item','pet','innate')
-- - provider_listeners(+log).per_cast_throttle_ms integer NULL
--   CHECK NULL OR >= 0
--
-- Safe contract:
-- - ADD COLUMN IF NOT EXISTS + guarded CHECK creation only
-- - no DELETE, DROP, CASCADE, data rewrite, or publish
-- - existing rows remain NULL (omitted / old behavior)

ALTER TABLE public.ability_definitions
    ADD COLUMN IF NOT EXISTS cast_origin varchar(16);

ALTER TABLE public.ability_definitions_log
    ADD COLUMN IF NOT EXISTS cast_origin varchar(16);

ALTER TABLE public.provider_listeners
    ADD COLUMN IF NOT EXISTS per_cast_throttle_ms integer;

ALTER TABLE public.provider_listeners_log
    ADD COLUMN IF NOT EXISTS per_cast_throttle_ms integer;

DO $$
BEGIN
    IF to_regclass('public.ability_definitions') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'ability_definitions'
              AND c.conname = 'ck_ability_definitions_cast_origin'
       ) THEN
        ALTER TABLE public.ability_definitions
            ADD CONSTRAINT ck_ability_definitions_cast_origin
            CHECK (
                cast_origin IS NULL
                OR cast_origin IN ('champion', 'item', 'pet', 'innate')
            );
    END IF;

    IF to_regclass('public.ability_definitions_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'ability_definitions_log'
              AND c.conname = 'ck_ability_definitions_log_cast_origin'
       ) THEN
        ALTER TABLE public.ability_definitions_log
            ADD CONSTRAINT ck_ability_definitions_log_cast_origin
            CHECK (
                cast_origin IS NULL
                OR cast_origin IN ('champion', 'item', 'pet', 'innate')
            );
    END IF;

    IF to_regclass('public.provider_listeners') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_listeners'
              AND c.conname = 'ck_provider_listeners_per_cast_throttle_ms'
       ) THEN
        ALTER TABLE public.provider_listeners
            ADD CONSTRAINT ck_provider_listeners_per_cast_throttle_ms
            CHECK (per_cast_throttle_ms IS NULL OR per_cast_throttle_ms >= 0);
    END IF;

    IF to_regclass('public.provider_listeners_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_listeners_log'
              AND c.conname = 'ck_provider_listeners_log_per_cast_throttle_ms'
       ) THEN
        ALTER TABLE public.provider_listeners_log
            ADD CONSTRAINT ck_provider_listeners_log_per_cast_throttle_ms
            CHECK (per_cast_throttle_ms IS NULL OR per_cast_throttle_ms >= 0);
    END IF;
END $$;
