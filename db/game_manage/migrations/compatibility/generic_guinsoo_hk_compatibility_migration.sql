-- =============================================================================
-- Guinsoo H+K compatibility (provider state fields / damage copyable / repeat)
-- =============================================================================
--
-- Idempotent upgrade for existing databases that already have the generic
-- combat-data model. Fresh installs should use schema.sql + triggers.sql +
-- reserved_types_seed.sql instead of this file.
--
-- Safe contract:
-- - ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS only
-- - no DELETE, no table/column/constraint drops, no primary-key rewrite
-- - after applying, re-run db/game_manage/triggers.sql so ensure_game_partitions
--   and effect-step exactly-one-detail triggers cover repeat_effect_details

-- -----------------------------------------------------------------------------
-- 1) provider_state_fields (+ log): optional stack/duration/refresh columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.provider_state_fields
    ADD COLUMN IF NOT EXISTS max_value numeric;

ALTER TABLE public.provider_state_fields
    ADD COLUMN IF NOT EXISTS duration_ms bigint;

ALTER TABLE public.provider_state_fields
    ADD COLUMN IF NOT EXISTS refresh_policy_type_id int;

ALTER TABLE public.provider_state_fields_log
    ADD COLUMN IF NOT EXISTS max_value numeric;

ALTER TABLE public.provider_state_fields_log
    ADD COLUMN IF NOT EXISTS duration_ms bigint;

ALTER TABLE public.provider_state_fields_log
    ADD COLUMN IF NOT EXISTS refresh_policy_type_id int;

DO $$
BEGIN
    IF to_regclass('public.provider_state_fields') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_state_fields'
              AND c.conname = 'ck_provider_state_fields_max_value'
       ) THEN
        ALTER TABLE public.provider_state_fields
            ADD CONSTRAINT ck_provider_state_fields_max_value
            CHECK (max_value IS NULL OR max_value > 0);
    END IF;

    IF to_regclass('public.provider_state_fields') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_state_fields'
              AND c.conname = 'ck_provider_state_fields_duration_ms'
       ) THEN
        ALTER TABLE public.provider_state_fields
            ADD CONSTRAINT ck_provider_state_fields_duration_ms
            CHECK (duration_ms IS NULL OR duration_ms > 0);
    END IF;

    IF to_regclass('public.provider_state_fields') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_state_fields'
              AND c.conname = 'fk_provider_state_fields_refresh_policy'
       )
       AND to_regclass('public.reserved_type') IS NOT NULL THEN
        ALTER TABLE public.provider_state_fields
            ADD CONSTRAINT fk_provider_state_fields_refresh_policy
            FOREIGN KEY (refresh_policy_type_id)
            REFERENCES public.reserved_type (type_id);
    END IF;

    IF to_regclass('public.provider_state_fields_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_state_fields_log'
              AND c.conname = 'ck_provider_state_fields_log_max_value'
       ) THEN
        ALTER TABLE public.provider_state_fields_log
            ADD CONSTRAINT ck_provider_state_fields_log_max_value
            CHECK (max_value IS NULL OR max_value > 0);
    END IF;

    IF to_regclass('public.provider_state_fields_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_state_fields_log'
              AND c.conname = 'ck_provider_state_fields_log_duration_ms'
       ) THEN
        ALTER TABLE public.provider_state_fields_log
            ADD CONSTRAINT ck_provider_state_fields_log_duration_ms
            CHECK (duration_ms IS NULL OR duration_ms > 0);
    END IF;

    IF to_regclass('public.provider_state_fields_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'provider_state_fields_log'
              AND c.conname = 'fk_provider_state_fields_log_refresh_policy'
       )
       AND to_regclass('public.reserved_type') IS NOT NULL THEN
        ALTER TABLE public.provider_state_fields_log
            ADD CONSTRAINT fk_provider_state_fields_log_refresh_policy
            FOREIGN KEY (refresh_policy_type_id)
            REFERENCES public.reserved_type (type_id);
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) damage_effect_details (+ log): copyable_on_hit default false
-- -----------------------------------------------------------------------------

ALTER TABLE public.damage_effect_details
    ADD COLUMN IF NOT EXISTS copyable_on_hit boolean NOT NULL DEFAULT false;

ALTER TABLE public.damage_effect_details_log
    ADD COLUMN IF NOT EXISTS copyable_on_hit boolean NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- 3) repeat_effect_details (+ log): tenth exactly-one detail family
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.repeat_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    repeat_scope_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    repeat_count int NOT NULL CHECK (repeat_count > 0),
    repeat_tag varchar(128) NOT NULL CHECK (repeat_tag <> ''),
    trigger_state_key varchar(128) NOT NULL CHECK (trigger_state_key <> ''),
    threshold numeric NOT NULL CHECK (threshold > 0),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_repeat_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_repeat_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.repeat_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    repeat_scope_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    repeat_count int NOT NULL CHECK (repeat_count > 0),
    repeat_tag varchar(128) NOT NULL CHECK (repeat_tag <> ''),
    trigger_state_key varchar(128) NOT NULL CHECK (trigger_state_key <> ''),
    threshold numeric NOT NULL CHECK (threshold > 0),
    CONSTRAINT pk_repeat_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_repeat_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

-- Ensure partitions for known games even if ensure_game_partitions is stale.
DO $$
DECLARE
    v_game_id varchar;
    v_parent text;
    v_parents text[] := ARRAY[
        'repeat_effect_details',
        'repeat_effect_details_log'
    ];
BEGIN
    FOREACH v_parent IN ARRAY v_parents
    LOOP
        IF to_regclass('public.' || v_parent) IS NULL THEN
            CONTINUE;
        END IF;
        FOR v_game_id IN SELECT game_id FROM public.games LOOP
            BEGIN
                EXECUTE format(
                    'CREATE TABLE IF NOT EXISTS %I PARTITION OF public.%I FOR VALUES IN (%L)',
                    v_parent || '_' || v_game_id,
                    v_parent,
                    v_game_id
                );
            EXCEPTION WHEN duplicate_table THEN
                NULL;
            END;
        END LOOP;
    END LOOP;
END;
$$;

-- Attach deferred exactly-one trigger on repeat detail when function exists.
-- Does not DROP existing triggers; re-run triggers.sql to refresh definitions.
DO $$
BEGIN
    IF to_regclass('public.repeat_effect_details') IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'trg_effect_step_exactly_one_detail'
    ) THEN
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'repeat_effect_details'
           AND t.tgname = 'trg_repeat_effect_details_exactly_one_detail'
    ) THEN
        RETURN;
    END IF;

    EXECUTE '
        CREATE CONSTRAINT TRIGGER trg_repeat_effect_details_exactly_one_detail
        AFTER INSERT OR UPDATE OR DELETE ON public.repeat_effect_details
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION public.trg_effect_step_exactly_one_detail()
    ';
END;
$$;

-- Prefer refreshed ensure_game_partitions when available (after triggers.sql).
DO $$
DECLARE
    v_game_id varchar;
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'ensure_game_partitions'
    ) THEN
        FOR v_game_id IN SELECT game_id FROM public.games LOOP
            PERFORM public.ensure_game_partitions(v_game_id);
        END LOOP;
    END IF;
END;
$$;

-- NOTE: Re-run db/game_manage/triggers.sql after this migration so
-- count_effect_step_details / ensure_game_partitions include repeat tables.
