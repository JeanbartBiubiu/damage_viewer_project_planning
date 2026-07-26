-- =============================================================================
-- Generic provider_lifecycles tick_anchor pair compatibility
-- =============================================================================
--
-- Idempotent upgrade for existing databases that already have
-- provider_lifecycles. Fresh installs should use schema.sql instead of this
-- file.
--
-- Adds (main + log):
-- - tick_anchor_scope_type_id int NULL REFERENCES reserved_type(type_id)
-- - tick_anchor_state_key varchar(128) NULL
-- - pairing CHECK: both null or both non-null
-- - non-empty CHECK when state_key is present
--
-- Safe contract:
-- - ADD COLUMN IF NOT EXISTS + guarded CHECK/FK creation only
-- - no DELETE, DROP, CASCADE, data rewrite, or publish
-- - existing rows remain NULL/NULL (omitted / old behavior)

ALTER TABLE public.provider_lifecycles
    ADD COLUMN IF NOT EXISTS tick_anchor_scope_type_id int;

ALTER TABLE public.provider_lifecycles
    ADD COLUMN IF NOT EXISTS tick_anchor_state_key varchar(128);

ALTER TABLE public.provider_lifecycles_log
    ADD COLUMN IF NOT EXISTS tick_anchor_scope_type_id int;

ALTER TABLE public.provider_lifecycles_log
    ADD COLUMN IF NOT EXISTS tick_anchor_state_key varchar(128);

DO $$
BEGIN
    IF to_regclass('public.provider_lifecycles') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_lifecycles'
              AND c.conname = 'ck_provider_lifecycles_tick_anchor_state_key'
       ) THEN
        ALTER TABLE public.provider_lifecycles
            ADD CONSTRAINT ck_provider_lifecycles_tick_anchor_state_key
            CHECK (tick_anchor_state_key IS NULL OR tick_anchor_state_key <> '');
    END IF;

    IF to_regclass('public.provider_lifecycles') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_lifecycles'
              AND c.conname = 'ck_provider_lifecycles_tick_anchor_pair'
       ) THEN
        ALTER TABLE public.provider_lifecycles
            ADD CONSTRAINT ck_provider_lifecycles_tick_anchor_pair
            CHECK (
                (tick_anchor_scope_type_id IS NULL) = (tick_anchor_state_key IS NULL)
            );
    END IF;

    IF to_regclass('public.provider_lifecycles') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_lifecycles'
              AND c.conname = 'fk_provider_lifecycles_tick_anchor_scope'
       )
       AND to_regclass('public.reserved_type') IS NOT NULL THEN
        ALTER TABLE public.provider_lifecycles
            ADD CONSTRAINT fk_provider_lifecycles_tick_anchor_scope
            FOREIGN KEY (tick_anchor_scope_type_id)
            REFERENCES public.reserved_type (type_id);
    END IF;

    IF to_regclass('public.provider_lifecycles_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_lifecycles_log'
              AND c.conname = 'ck_provider_lifecycles_log_tick_anchor_state_key'
       ) THEN
        ALTER TABLE public.provider_lifecycles_log
            ADD CONSTRAINT ck_provider_lifecycles_log_tick_anchor_state_key
            CHECK (tick_anchor_state_key IS NULL OR tick_anchor_state_key <> '');
    END IF;

    IF to_regclass('public.provider_lifecycles_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_lifecycles_log'
              AND c.conname = 'ck_provider_lifecycles_log_tick_anchor_pair'
       ) THEN
        ALTER TABLE public.provider_lifecycles_log
            ADD CONSTRAINT ck_provider_lifecycles_log_tick_anchor_pair
            CHECK (
                (tick_anchor_scope_type_id IS NULL) = (tick_anchor_state_key IS NULL)
            );
    END IF;

    IF to_regclass('public.provider_lifecycles_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_lifecycles_log'
              AND c.conname = 'fk_provider_lifecycles_log_tick_anchor_scope'
       )
       AND to_regclass('public.reserved_type') IS NOT NULL THEN
        ALTER TABLE public.provider_lifecycles_log
            ADD CONSTRAINT fk_provider_lifecycles_log_tick_anchor_scope
            FOREIGN KEY (tick_anchor_scope_type_id)
            REFERENCES public.reserved_type (type_id);
    END IF;
END $$;
