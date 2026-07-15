-- =============================================================================
-- Generic Execute Threshold compatibility (execute_effect_details)
-- =============================================================================
--
-- Idempotent upgrade for existing databases that already have the generic
-- combat-data model. Fresh installs should use schema.sql + triggers.sql +
-- reserved_types_seed.sql instead of this file.
--
-- Safe contract:
-- - CREATE TABLE IF NOT EXISTS only
-- - no DELETE, no table/column/constraint drops, no primary-key rewrite
-- - after applying, re-run db/game_manage/triggers.sql so ensure_game_partitions
--   and effect-step exactly-one-detail triggers cover execute_effect_details

-- -----------------------------------------------------------------------------
-- execute_effect_details (+ log): eleventh exactly-one detail family
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.execute_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    threshold numeric NOT NULL CHECK (threshold > 0 AND threshold <= 1),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_execute_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_execute_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.execute_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    threshold numeric NOT NULL CHECK (threshold > 0 AND threshold <= 1),
    CONSTRAINT pk_execute_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_execute_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

-- Ensure partitions for known games even if ensure_game_partitions is stale.
DO $$
DECLARE
    v_game_id varchar;
    v_parent text;
    v_parents text[] := ARRAY[
        'execute_effect_details',
        'execute_effect_details_log'
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

-- Attach deferred exactly-one trigger on execute detail when function exists.
-- Does not DROP existing triggers; re-run triggers.sql to refresh definitions.
DO $$
BEGIN
    IF to_regclass('public.execute_effect_details') IS NULL THEN
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
           AND c.relname = 'execute_effect_details'
           AND t.tgname = 'trg_execute_effect_details_exactly_one_detail'
    ) THEN
        RETURN;
    END IF;

    EXECUTE '
        CREATE CONSTRAINT TRIGGER trg_execute_effect_details_exactly_one_detail
        AFTER INSERT OR UPDATE OR DELETE ON public.execute_effect_details
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
-- count_effect_step_details / ensure_game_partitions include execute tables.
