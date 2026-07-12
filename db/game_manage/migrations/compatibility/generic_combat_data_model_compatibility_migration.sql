-- =============================================================================
-- Generic 1v1 combat data model - compatibility migration (idempotent)
-- =============================================================================
--
-- For already-deployed databases. Safe to re-run.
-- Does NOT DROP legacy hero/item/skill/... tables.
-- Does NOT use CASCADE.
-- After this migration, re-run db/game_manage/triggers.sql to refresh
-- ensure_game_partitions / effect-detail deferred triggers / state backfill.

-- -----------------------------------------------------------------------------
-- 1. game_data_state
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.game_data_state (
    game_id varchar(64) PRIMARY KEY REFERENCES public.games(game_id),
    current_revision bigint NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    published_revision bigint NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CHECK (published_revision <= current_revision)
);

INSERT INTO public.game_data_state (game_id, current_revision, published_revision, updated_at)
SELECT g.game_id, 0, 0, NOW()
  FROM public.games g
 WHERE NOT EXISTS (
       SELECT 1 FROM public.game_data_state s WHERE s.game_id = g.game_id
 )
ON CONFLICT (game_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. game_versions.change_revision
-- -----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'game_versions'
           AND column_name = 'change_revision'
    ) THEN
        ALTER TABLE public.game_versions
            ADD COLUMN change_revision bigint NOT NULL DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'game_versions_change_revision_check'
           AND conrelid = 'public.game_versions'::regclass
    ) THEN
        ALTER TABLE public.game_versions
            ADD CONSTRAINT game_versions_change_revision_check
            CHECK (change_revision >= 0);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. reserved_type.type_key
-- -----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'reserved_type'
           AND column_name = 'type_key'
    ) THEN
        ALTER TABLE public.reserved_type ADD COLUMN type_key varchar(128);
    END IF;
END $$;

UPDATE public.reserved_type
   SET type_key = CASE type_id
        WHEN 10000 THEN 'attribute_entry_group'
        WHEN 10002 THEN 'wasm_sim_validation_status'
        WHEN 20000 THEN 'attribute_hero_progression'
        WHEN 20001 THEN 'attribute_mechanic_only'
        WHEN 20010 THEN 'wasm_sim_dps_attacker_verified'
        ELSE COALESCE(type_key, 'reserved/' || type_id::text)
   END
 WHERE type_key IS NULL OR type_key = '';

DO $$
BEGIN
    ALTER TABLE public.reserved_type ALTER COLUMN type_key SET NOT NULL;
EXCEPTION WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_reserved_type_type_key'
           AND conrelid = 'public.reserved_type'::regclass
    ) THEN
        ALTER TABLE public.reserved_type
            ADD CONSTRAINT uq_reserved_type_type_key UNIQUE (type_key);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. game_progression_schema.change_revision + log
-- -----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'game_progression_schema'
           AND column_name = 'change_revision'
    ) THEN
        ALTER TABLE public.game_progression_schema
            ADD COLUMN change_revision bigint;
        UPDATE public.game_progression_schema
           SET change_revision = 1
         WHERE change_revision IS NULL;
        ALTER TABLE public.game_progression_schema
            ALTER COLUMN change_revision SET NOT NULL;
        ALTER TABLE public.game_progression_schema
            ADD CONSTRAINT game_progression_schema_change_revision_check
            CHECK (change_revision > 0);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.game_progression_schema_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    progression_kind varchar(16) NOT NULL CHECK (progression_kind IN ('LEVEL', 'STAR')),
    stage_min int NOT NULL CHECK (stage_min >= 1),
    stage_max int NOT NULL CHECK (stage_max >= stage_min AND stage_max <= 100),
    stage_label varchar(32) NOT NULL,
    require_all_stages boolean NOT NULL DEFAULT true,
    CONSTRAINT pk_game_progression_schema_log PRIMARY KEY (game_id, version_id),
    CONSTRAINT fk_game_progression_schema_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)
);

-- -----------------------------------------------------------------------------
-- 5. Helper: migrate a partitioned latest table from start/end -> change_revision
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._compat_migrate_revision_latest(
    p_table text,
    p_drop_fks text[] DEFAULT ARRAY[]::text[]
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_fk text;
BEGIN
    IF to_regclass('public.' || p_table) IS NULL THEN
        RETURN;
    END IF;

    FOREACH v_fk IN ARRAY p_drop_fks
    LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', p_table, v_fk);
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=p_table AND column_name='change_revision'
    ) IS FALSE THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN change_revision bigint', p_table);
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=p_table AND column_name='end_version_id'
        ) THEN
            EXECUTE format(
                'UPDATE public.%I SET change_revision = GREATEST(1, COALESCE(end_version_id, start_version_id, 1)) WHERE change_revision IS NULL',
                p_table
            );
        ELSE
            EXECUTE format('UPDATE public.%I SET change_revision = 1 WHERE change_revision IS NULL', p_table);
        END IF;
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN change_revision SET NOT NULL', p_table);
        BEGIN
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (change_revision > 0)',
                p_table,
                p_table || '_change_revision_check'
            );
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=p_table AND column_name='start_version_id'
    ) THEN
        EXECUTE format('ALTER TABLE public.%I DROP COLUMN start_version_id', p_table);
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=p_table AND column_name='end_version_id'
    ) THEN
        EXECUTE format('ALTER TABLE public.%I DROP COLUMN end_version_id', p_table);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._compat_migrate_revision_log(
    p_table text,
    p_old_pk text,
    p_new_pk_cols text,
    p_drop_fks text[] DEFAULT ARRAY[]::text[]
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_fk text;
BEGIN
    IF to_regclass('public.' || p_table) IS NULL THEN
        RETURN;
    END IF;

    FOREACH v_fk IN ARRAY p_drop_fks
    LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', p_table, v_fk);
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=p_table AND column_name='version_id'
    ) IS FALSE THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN version_id bigint', p_table);
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=p_table AND column_name='start_version_id'
        ) THEN
            EXECUTE format('UPDATE public.%I SET version_id = start_version_id WHERE version_id IS NULL', p_table);
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=p_table AND column_name='change_revision'
    ) IS FALSE THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN change_revision bigint', p_table);
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=p_table AND column_name='end_version_id'
        ) THEN
            EXECUTE format(
                'UPDATE public.%I SET change_revision = GREATEST(1, COALESCE(end_version_id, start_version_id, version_id, 1)) WHERE change_revision IS NULL',
                p_table
            );
        ELSE
            EXECUTE format(
                'UPDATE public.%I SET change_revision = GREATEST(1, COALESCE(version_id, 1)) WHERE change_revision IS NULL',
                p_table
            );
        END IF;
    END IF;

    EXECUTE format('UPDATE public.%I SET version_id = COALESCE(version_id, 0) WHERE version_id IS NULL', p_table);
    EXECUTE format('UPDATE public.%I SET change_revision = COALESCE(change_revision, 1) WHERE change_revision IS NULL', p_table);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN version_id SET NOT NULL', p_table);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN change_revision SET NOT NULL', p_table);

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', p_table, p_old_pk);
    BEGIN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (%s)', p_table, p_old_pk, p_new_pk_cols);
    EXCEPTION WHEN duplicate_object THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (game_id, version_id) REFERENCES public.game_versions (game_id, version_id)',
            p_table,
            'fk_' || p_table || '_version'
        );
    EXCEPTION WHEN duplicate_object THEN
        NULL;
    END;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=p_table AND column_name='start_version_id'
    ) THEN
        EXECUTE format('ALTER TABLE public.%I DROP COLUMN start_version_id', p_table);
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=p_table AND column_name='end_version_id'
    ) THEN
        EXECUTE format('ALTER TABLE public.%I DROP COLUMN end_version_id', p_table);
    END IF;
END;
$$;

SELECT public._compat_migrate_revision_latest(
    'attribute_definitions',
    ARRAY['fk_attribute_definitions_start_version', 'fk_attribute_definitions_end_version']
);
SELECT public._compat_migrate_revision_log(
    'attribute_definitions_log',
    'pk_attribute_definitions_log',
    'game_id, attr_key, version_id',
    ARRAY['fk_attribute_definitions_log_start_version', 'fk_attribute_definitions_log_end_version']
);

SELECT public._compat_migrate_revision_latest(
    'types',
    ARRAY['fk_types_start_version', 'fk_types_end_version']
);
SELECT public._compat_migrate_revision_log(
    'types_log',
    'pk_types_log',
    'game_id, type_id, version_id',
    ARRAY['fk_types_log_start_version', 'fk_types_log_end_version']
);

SELECT public._compat_migrate_revision_latest(
    'type_relations',
    ARRAY[]::text[]
);
SELECT public._compat_migrate_revision_log(
    'type_relations_log',
    'pk_type_relations_log',
    'game_id, type_id, target_category, target_id, version_id',
    ARRAY[]::text[]
);

-- types.type_key
DO $$
BEGIN
    IF to_regclass('public.types') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='types' AND column_name='type_key'
       ) THEN
        ALTER TABLE public.types ADD COLUMN type_key varchar(128);
    END IF;
END $$;

UPDATE public.types
   SET type_key = COALESCE(NULLIF(type_key, ''), 'type/' || type_id::text)
 WHERE type_key IS NULL OR type_key = '';

DO $$
BEGIN
    IF to_regclass('public.types') IS NOT NULL THEN
        ALTER TABLE public.types ALTER COLUMN type_key SET NOT NULL;
    END IF;
EXCEPTION WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
    IF to_regclass('public.types') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conname = 'uq_types_game_type_key'
              AND conrelid = 'public.types'::regclass
       ) THEN
        ALTER TABLE public.types ADD CONSTRAINT uq_types_game_type_key UNIQUE (game_id, type_key);
    END IF;
END $$;

-- types_log.type_key
DO $$
BEGIN
    IF to_regclass('public.types_log') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='types_log' AND column_name='type_key'
       ) THEN
        ALTER TABLE public.types_log ADD COLUMN type_key varchar(128);
    END IF;
END $$;

UPDATE public.types_log
   SET type_key = COALESCE(NULLIF(type_key, ''), 'type/' || type_id::text)
 WHERE type_key IS NULL OR type_key = '';

DO $$
BEGIN
    IF to_regclass('public.types_log') IS NOT NULL THEN
        ALTER TABLE public.types_log ALTER COLUMN type_key SET NOT NULL;
    END IF;
EXCEPTION WHEN others THEN
    NULL;
END $$;

-- type_relations: drop polymorphic FK to types, drop deleted, expand target_category
DO $$
BEGIN
    IF to_regclass('public.type_relations') IS NOT NULL THEN
        ALTER TABLE public.type_relations DROP CONSTRAINT IF EXISTS fk_type_relations_type;
    END IF;
    IF to_regclass('public.type_relations_log') IS NOT NULL THEN
        ALTER TABLE public.type_relations_log DROP CONSTRAINT IF EXISTS fk_type_relations_log_type;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='type_relations' AND column_name='deleted'
    ) THEN
        -- 迁移期：tombstone 行不再进入新模型；先物理删除软删行再丢列（无 CASCADE）
        DELETE FROM public.type_relations WHERE deleted = TRUE;
        ALTER TABLE public.type_relations DROP COLUMN deleted;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='type_relations_log' AND column_name='deleted'
    ) THEN
        DELETE FROM public.type_relations_log WHERE deleted = TRUE;
        ALTER TABLE public.type_relations_log DROP COLUMN deleted;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.type_relations') IS NOT NULL THEN
        ALTER TABLE public.type_relations DROP CONSTRAINT IF EXISTS type_relations_target_category_check;
        ALTER TABLE public.type_relations
            ADD CONSTRAINT type_relations_target_category_check
            CHECK (target_category IN (
                'entity','attribute','resource','provider','ability','ability_phase',
                'modifier','listener','effect_step','type','equipment','skill','character'
            ));
    END IF;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
    IF to_regclass('public.type_relations_log') IS NOT NULL THEN
        ALTER TABLE public.type_relations_log DROP CONSTRAINT IF EXISTS type_relations_log_target_category_check;
        ALTER TABLE public.type_relations_log
            ADD CONSTRAINT type_relations_log_target_category_check
            CHECK (target_category IN (
                'entity','attribute','resource','provider','ability','ability_phase',
                'modifier','listener','effect_step','type','equipment','skill','character'
            ));
    END IF;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

DROP FUNCTION IF EXISTS public._compat_migrate_revision_latest(text, text[]);
DROP FUNCTION IF EXISTS public._compat_migrate_revision_log(text, text, text, text[]);

-- -----------------------------------------------------------------------------
-- 6. New combat parent tables (IF NOT EXISTS) + partition/state refresh hook
-- -----------------------------------------------------------------------------
-- 9. Generic 1v1 Combat Data Model (revision-based latest tables + publish logs)
-- -----------------------------------------------------------------------------


CREATE TABLE IF NOT EXISTS public.game_entities (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    display_name varchar(100) NOT NULL,
    description text,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_game_entities PRIMARY KEY (game_id, entity_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.game_entities_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    display_name varchar(100) NOT NULL,
    description text,
    CONSTRAINT pk_game_entities_log PRIMARY KEY (game_id, entity_id, version_id),
    CONSTRAINT fk_game_entities_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.game_entities IS '战斗相关实体身份（角色/装备/符文等；类别走 type_relations）';


CREATE TABLE IF NOT EXISTS public.entity_attribute_values (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    base_value numeric NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_entity_attribute_values PRIMARY KEY (game_id, entity_id, attr_key),
    CONSTRAINT fk_entity_attribute_values_entity FOREIGN KEY (game_id, entity_id)
        REFERENCES public.game_entities (game_id, entity_id),
    CONSTRAINT fk_entity_attribute_values_attr FOREIGN KEY (game_id, attr_key)
        REFERENCES public.attribute_definitions (game_id, attr_key)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.entity_attribute_values_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    base_value numeric NOT NULL,
    CONSTRAINT pk_entity_attribute_values_log PRIMARY KEY (game_id, entity_id, attr_key, version_id),
    CONSTRAINT fk_entity_attribute_values_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.entity_attribute_values IS '实体属性基础值';


CREATE TABLE IF NOT EXISTS public.entity_attribute_stage_values (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    stage int NOT NULL CHECK (stage >= 1),
    value numeric NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_entity_attribute_stage_values PRIMARY KEY (game_id, entity_id, attr_key, stage),
    CONSTRAINT fk_entity_attribute_stage_values_base FOREIGN KEY (game_id, entity_id, attr_key)
        REFERENCES public.entity_attribute_values (game_id, entity_id, attr_key)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.entity_attribute_stage_values_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    stage int NOT NULL CHECK (stage >= 1),
    value numeric NOT NULL,
    CONSTRAINT pk_entity_attribute_stage_values_log PRIMARY KEY (game_id, entity_id, attr_key, stage, version_id),
    CONSTRAINT fk_entity_attribute_stage_values_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.entity_attribute_stage_values IS '实体属性 stage 绝对值';


CREATE TABLE IF NOT EXISTS public.resource_definitions (
    game_id varchar(64) NOT NULL,
    resource_key varchar(64) NOT NULL,
    display_name varchar(100) NOT NULL,
    default_initial_value numeric NOT NULL DEFAULT 0,
    default_max_value numeric NOT NULL DEFAULT 0,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_resource_definitions PRIMARY KEY (game_id, resource_key)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.resource_definitions_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    resource_key varchar(64) NOT NULL,
    display_name varchar(100) NOT NULL,
    default_initial_value numeric NOT NULL DEFAULT 0,
    default_max_value numeric NOT NULL DEFAULT 0,
    CONSTRAINT pk_resource_definitions_log PRIMARY KEY (game_id, resource_key, version_id),
    CONSTRAINT fk_resource_definitions_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.resource_definitions IS '资源定义（生命/法力等）';


CREATE TABLE IF NOT EXISTS public.entity_resource_values (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    resource_key varchar(64) NOT NULL,
    initial_value numeric NOT NULL,
    max_value numeric NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_entity_resource_values PRIMARY KEY (game_id, entity_id, resource_key),
    CONSTRAINT fk_entity_resource_values_entity FOREIGN KEY (game_id, entity_id)
        REFERENCES public.game_entities (game_id, entity_id),
    CONSTRAINT fk_entity_resource_values_resource FOREIGN KEY (game_id, resource_key)
        REFERENCES public.resource_definitions (game_id, resource_key)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.entity_resource_values_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    resource_key varchar(64) NOT NULL,
    initial_value numeric NOT NULL,
    max_value numeric NOT NULL,
    CONSTRAINT pk_entity_resource_values_log PRIMARY KEY (game_id, entity_id, resource_key, version_id),
    CONSTRAINT fk_entity_resource_values_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.entity_resource_stage_values (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    resource_key varchar(64) NOT NULL,
    stage int NOT NULL CHECK (stage >= 1),
    initial_value numeric NOT NULL,
    max_value numeric NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_entity_resource_stage_values PRIMARY KEY (game_id, entity_id, resource_key, stage),
    CONSTRAINT fk_entity_resource_stage_values_base FOREIGN KEY (game_id, entity_id, resource_key)
        REFERENCES public.entity_resource_values (game_id, entity_id, resource_key)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.entity_resource_stage_values_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    resource_key varchar(64) NOT NULL,
    stage int NOT NULL CHECK (stage >= 1),
    initial_value numeric NOT NULL,
    max_value numeric NOT NULL,
    CONSTRAINT pk_entity_resource_stage_values_log PRIMARY KEY (game_id, entity_id, resource_key, stage, version_id),
    CONSTRAINT fk_entity_resource_stage_values_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.provider_definitions (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    provider_kind_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    display_name varchar(100) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_definitions PRIMARY KEY (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.provider_definitions_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    provider_kind_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    display_name varchar(100) NOT NULL,
    CONSTRAINT pk_provider_definitions_log PRIMARY KEY (game_id, provider_id, version_id),
    CONSTRAINT fk_provider_definitions_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.provider_definitions IS '被动/状态/装备效果等 provider 定义';


CREATE TABLE IF NOT EXISTS public.provider_formulas (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    formula_key varchar(128) NOT NULL,
    expression jsonb NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_formulas PRIMARY KEY (game_id, provider_id, formula_key),
    CONSTRAINT fk_provider_formulas_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT ck_provider_formulas_expression_object CHECK (jsonb_typeof(expression) = 'object')

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.provider_formulas_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    formula_key varchar(128) NOT NULL,
    expression jsonb NOT NULL,
    CONSTRAINT pk_provider_formulas_log PRIMARY KEY (game_id, provider_id, formula_key, version_id),
    CONSTRAINT fk_provider_formulas_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_provider_formulas_log_expression_object CHECK (jsonb_typeof(expression) = 'object')

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.provider_formulas IS 'provider 内共享公式；禁止跨 provider FK';


CREATE TABLE IF NOT EXISTS public.provider_lifecycles (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    duration_formula_key varchar(128),
    max_stacks int NOT NULL DEFAULT 1 CHECK (max_stacks >= 1),
    refresh_policy_type_id int REFERENCES public.reserved_type(type_id),
    tick_interval_ms int CHECK (tick_interval_ms IS NULL OR tick_interval_ms >= 0),
    start_delay_ms int CHECK (start_delay_ms IS NULL OR start_delay_ms >= 0),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_lifecycles PRIMARY KEY (game_id, provider_id),
    CONSTRAINT fk_provider_lifecycles_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT fk_provider_lifecycles_duration_formula FOREIGN KEY (game_id, provider_id, duration_formula_key)
        REFERENCES public.provider_formulas (game_id, provider_id, formula_key)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.provider_lifecycles_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    duration_formula_key varchar(128),
    max_stacks int NOT NULL DEFAULT 1 CHECK (max_stacks >= 1),
    refresh_policy_type_id int REFERENCES public.reserved_type(type_id),
    tick_interval_ms int CHECK (tick_interval_ms IS NULL OR tick_interval_ms >= 0),
    start_delay_ms int CHECK (start_delay_ms IS NULL OR start_delay_ms >= 0),
    CONSTRAINT pk_provider_lifecycles_log PRIMARY KEY (game_id, provider_id, version_id),
    CONSTRAINT fk_provider_lifecycles_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.provider_lifecycles IS 'provider 生命周期；duration_formula 同 provider 复合 FK';


CREATE TABLE IF NOT EXISTS public.entity_provider_mounts (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_entity_provider_mounts PRIMARY KEY (game_id, entity_id, provider_id),
    CONSTRAINT fk_entity_provider_mounts_entity FOREIGN KEY (game_id, entity_id)
        REFERENCES public.game_entities (game_id, entity_id),
    CONSTRAINT fk_entity_provider_mounts_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.entity_provider_mounts_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    CONSTRAINT pk_entity_provider_mounts_log PRIMARY KEY (game_id, entity_id, provider_id, version_id),
    CONSTRAINT fk_entity_provider_mounts_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.provider_state_fields (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    state_key varchar(128) NOT NULL,
    value_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_state_fields PRIMARY KEY (game_id, provider_id, state_key),
    CONSTRAINT fk_provider_state_fields_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.provider_state_fields_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    state_key varchar(128) NOT NULL,
    value_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_provider_state_fields_log PRIMARY KEY (game_id, provider_id, state_key, version_id),
    CONSTRAINT fk_provider_state_fields_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.ability_definitions (
    game_id varchar(64) NOT NULL,
    ability_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    ability_key varchar(128) NOT NULL,
    ability_kind_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    display_name varchar(100) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_definitions PRIMARY KEY (game_id, ability_id),
    CONSTRAINT uq_ability_definitions_provider_key UNIQUE (game_id, provider_id, ability_key),
    CONSTRAINT fk_ability_definitions_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.ability_definitions_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    ability_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    ability_key varchar(128) NOT NULL,
    ability_kind_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    display_name varchar(100) NOT NULL,
    CONSTRAINT pk_ability_definitions_log PRIMARY KEY (game_id, ability_id, version_id),
    CONSTRAINT fk_ability_definitions_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.ability_parameters (
    game_id varchar(64) NOT NULL,
    ability_id varchar(256) NOT NULL,
    param_key varchar(128) NOT NULL,
    numeric_value numeric NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_parameters PRIMARY KEY (game_id, ability_id, param_key),
    CONSTRAINT fk_ability_parameters_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.ability_parameters_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    ability_id varchar(256) NOT NULL,
    param_key varchar(128) NOT NULL,
    numeric_value numeric NOT NULL,
    CONSTRAINT pk_ability_parameters_log PRIMARY KEY (game_id, ability_id, param_key, version_id),
    CONSTRAINT fk_ability_parameters_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.ability_state_fields (
    game_id varchar(64) NOT NULL,
    ability_id varchar(256) NOT NULL,
    state_key varchar(128) NOT NULL,
    value_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_state_fields PRIMARY KEY (game_id, ability_id, state_key),
    CONSTRAINT fk_ability_state_fields_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.ability_state_fields_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    ability_id varchar(256) NOT NULL,
    state_key varchar(128) NOT NULL,
    value_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_ability_state_fields_log PRIMARY KEY (game_id, ability_id, state_key, version_id),
    CONSTRAINT fk_ability_state_fields_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.ability_phases (
    game_id varchar(64) NOT NULL,
    phase_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    phase_order int NOT NULL CHECK (phase_order >= 0),
    phase_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    duration_formula_key varchar(128),
    interruptible boolean NOT NULL DEFAULT true,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_phases PRIMARY KEY (game_id, phase_id),
    CONSTRAINT uq_ability_phases_order UNIQUE (game_id, ability_id, phase_order),
    CONSTRAINT fk_ability_phases_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.ability_phases_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    phase_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    phase_order int NOT NULL CHECK (phase_order >= 0),
    phase_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    duration_formula_key varchar(128),
    interruptible boolean NOT NULL DEFAULT true,
    CONSTRAINT pk_ability_phases_log PRIMARY KEY (game_id, phase_id, version_id),
    CONSTRAINT fk_ability_phases_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.ability_costs (
    game_id varchar(64) NOT NULL,
    cost_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    phase_id varchar(256),
    resource_key varchar(64) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    allow_partial boolean NOT NULL DEFAULT false,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_costs PRIMARY KEY (game_id, cost_id),
    CONSTRAINT fk_ability_costs_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id),
    CONSTRAINT fk_ability_costs_phase FOREIGN KEY (game_id, phase_id)
        REFERENCES public.ability_phases (game_id, phase_id),
    CONSTRAINT fk_ability_costs_resource FOREIGN KEY (game_id, resource_key)
        REFERENCES public.resource_definitions (game_id, resource_key)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.ability_costs_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    cost_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    phase_id varchar(256),
    resource_key varchar(64) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    allow_partial boolean NOT NULL DEFAULT false,
    CONSTRAINT pk_ability_costs_log PRIMARY KEY (game_id, cost_id, version_id),
    CONSTRAINT fk_ability_costs_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.ability_cooldowns (
    game_id varchar(64) NOT NULL,
    cooldown_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    duration_formula_key varchar(128) NOT NULL,
    starts_on_phase_id varchar(256),
    group_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_cooldowns PRIMARY KEY (game_id, cooldown_id),
    CONSTRAINT fk_ability_cooldowns_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id),
    CONSTRAINT fk_ability_cooldowns_phase FOREIGN KEY (game_id, starts_on_phase_id)
        REFERENCES public.ability_phases (game_id, phase_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.ability_cooldowns_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    cooldown_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    duration_formula_key varchar(128) NOT NULL,
    starts_on_phase_id varchar(256),
    group_key varchar(128),
    CONSTRAINT pk_ability_cooldowns_log PRIMARY KEY (game_id, cooldown_id, version_id),
    CONSTRAINT fk_ability_cooldowns_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.provider_modifiers (
    game_id varchar(64) NOT NULL,
    modifier_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    modifier_key varchar(128) NOT NULL,
    modifier_type_id int REFERENCES public.reserved_type(type_id),
    target_selector_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_attr_key varchar(64) NOT NULL,
    command_type_id int REFERENCES public.reserved_type(type_id),
    channel_type_id int REFERENCES public.reserved_type(type_id),
    bucket_type_id int REFERENCES public.reserved_type(type_id),
    stage_type_id int REFERENCES public.reserved_type(type_id),
    priority int NOT NULL DEFAULT 0,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    value_formula_key varchar(128) NOT NULL,
    condition_formula_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_modifiers PRIMARY KEY (game_id, modifier_id),
    CONSTRAINT fk_provider_modifiers_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT fk_provider_modifiers_attr FOREIGN KEY (game_id, target_attr_key)
        REFERENCES public.attribute_definitions (game_id, attr_key)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.provider_modifiers_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    modifier_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    modifier_key varchar(128) NOT NULL,
    modifier_type_id int REFERENCES public.reserved_type(type_id),
    target_selector_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_attr_key varchar(64) NOT NULL,
    command_type_id int REFERENCES public.reserved_type(type_id),
    channel_type_id int REFERENCES public.reserved_type(type_id),
    bucket_type_id int REFERENCES public.reserved_type(type_id),
    stage_type_id int REFERENCES public.reserved_type(type_id),
    priority int NOT NULL DEFAULT 0,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    value_formula_key varchar(128) NOT NULL,
    condition_formula_key varchar(128),
    CONSTRAINT pk_provider_modifiers_log PRIMARY KEY (game_id, modifier_id, version_id),
    CONSTRAINT fk_provider_modifiers_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.provider_listeners (
    game_id varchar(64) NOT NULL,
    listener_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    listener_key varchar(128) NOT NULL,
    event_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    ability_id varchar(256),
    max_triggers_per_event int CHECK (max_triggers_per_event IS NULL OR max_triggers_per_event >= 0),
    chain_limit_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_listeners PRIMARY KEY (game_id, listener_id),
    CONSTRAINT fk_provider_listeners_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT fk_provider_listeners_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.provider_listeners_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    listener_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    listener_key varchar(128) NOT NULL,
    event_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    ability_id varchar(256),
    max_triggers_per_event int CHECK (max_triggers_per_event IS NULL OR max_triggers_per_event >= 0),
    chain_limit_key varchar(128),
    CONSTRAINT pk_provider_listeners_log PRIMARY KEY (game_id, listener_id, version_id),
    CONSTRAINT fk_provider_listeners_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.listener_match_types (
    game_id varchar(64) NOT NULL,
    listener_id varchar(256) NOT NULL,
    match_mode_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    type_id int NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_listener_match_types PRIMARY KEY (game_id, listener_id, match_mode_type_id, type_id),
    CONSTRAINT fk_listener_match_types_listener FOREIGN KEY (game_id, listener_id)
        REFERENCES public.provider_listeners (game_id, listener_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.listener_match_types_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    listener_id varchar(256) NOT NULL,
    match_mode_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    type_id int NOT NULL,
    CONSTRAINT pk_listener_match_types_log PRIMARY KEY (game_id, listener_id, match_mode_type_id, type_id, version_id),
    CONSTRAINT fk_listener_match_types_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.listener_match_types IS 'listener type matcher；type_id 解析 reserved/game-local，无 polymorphic FK';


CREATE TABLE IF NOT EXISTS public.effect_sequences (
    game_id varchar(64) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    sequence_key varchar(128) NOT NULL,
    display_name varchar(100),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_effect_sequences PRIMARY KEY (game_id, sequence_id),
    CONSTRAINT uq_effect_sequences_provider_key UNIQUE (game_id, provider_id, sequence_key),
    CONSTRAINT fk_effect_sequences_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.effect_sequences_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    sequence_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    sequence_key varchar(128) NOT NULL,
    display_name varchar(100),
    CONSTRAINT pk_effect_sequences_log PRIMARY KEY (game_id, sequence_id, version_id),
    CONSTRAINT fk_effect_sequences_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.effect_steps (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    step_order int NOT NULL CHECK (step_order >= 0),
    operation_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_selector_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    condition_formula_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_effect_steps PRIMARY KEY (game_id, step_id),
    CONSTRAINT uq_effect_steps_order UNIQUE (game_id, sequence_id, step_order),
    CONSTRAINT fk_effect_steps_sequence FOREIGN KEY (game_id, sequence_id)
        REFERENCES public.effect_sequences (game_id, sequence_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.effect_steps_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    step_order int NOT NULL CHECK (step_order >= 0),
    operation_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_selector_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    condition_formula_key varchar(128),
    CONSTRAINT pk_effect_steps_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_effect_steps_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.effect_steps IS 'effect sequence 步骤公共行；提交时必须恰好一种 detail';


CREATE TABLE IF NOT EXISTS public.ability_phase_effect_sequences (
    game_id varchar(64) NOT NULL,
    phase_id varchar(256) NOT NULL,
    trigger_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    sequence_id varchar(256) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_phase_effect_sequences PRIMARY KEY (game_id, phase_id, trigger_type_id, sequence_id),
    CONSTRAINT fk_ability_phase_effect_sequences_phase FOREIGN KEY (game_id, phase_id)
        REFERENCES public.ability_phases (game_id, phase_id),
    CONSTRAINT fk_ability_phase_effect_sequences_sequence FOREIGN KEY (game_id, sequence_id)
        REFERENCES public.effect_sequences (game_id, sequence_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.ability_phase_effect_sequences_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    phase_id varchar(256) NOT NULL,
    trigger_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    sequence_id varchar(256) NOT NULL,
    CONSTRAINT pk_ability_phase_effect_sequences_log PRIMARY KEY (game_id, phase_id, trigger_type_id, sequence_id, version_id),
    CONSTRAINT fk_ability_phase_effect_sequences_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.listener_effect_sequences (
    game_id varchar(64) NOT NULL,
    listener_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_listener_effect_sequences PRIMARY KEY (game_id, listener_id, sequence_id),
    CONSTRAINT fk_listener_effect_sequences_listener FOREIGN KEY (game_id, listener_id)
        REFERENCES public.provider_listeners (game_id, listener_id),
    CONSTRAINT fk_listener_effect_sequences_sequence FOREIGN KEY (game_id, sequence_id)
        REFERENCES public.effect_sequences (game_id, sequence_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.listener_effect_sequences_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    listener_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    CONSTRAINT pk_listener_effect_sequences_log PRIMARY KEY (game_id, listener_id, sequence_id, version_id),
    CONSTRAINT fk_listener_effect_sequences_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.provider_tick_sequences (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_tick_sequences PRIMARY KEY (game_id, provider_id, sequence_id),
    CONSTRAINT fk_provider_tick_sequences_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT fk_provider_tick_sequences_sequence FOREIGN KEY (game_id, sequence_id)
        REFERENCES public.effect_sequences (game_id, sequence_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.provider_tick_sequences_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    CONSTRAINT pk_provider_tick_sequences_log PRIMARY KEY (game_id, provider_id, sequence_id, version_id),
    CONSTRAINT fk_provider_tick_sequences_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.damage_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    damage_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_damage_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_damage_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.damage_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    damage_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_damage_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_damage_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.heal_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_heal_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_heal_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.heal_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_heal_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_heal_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.resource_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    resource_key varchar(64) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_resource_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_resource_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.resource_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    resource_key varchar(64) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_resource_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_resource_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.attribute_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_attribute_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_attribute_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.attribute_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_attribute_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_attribute_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.shield_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    shield_ref varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    duration_formula_key varchar(128),
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_shield_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_shield_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.shield_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    shield_ref varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    duration_formula_key varchar(128),
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_shield_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_shield_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.provider_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    action_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_provider_id varchar(256) NOT NULL,
    stacks_formula_key varchar(128),
    duration_formula_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_provider_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.provider_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    action_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_provider_id varchar(256) NOT NULL,
    stacks_formula_key varchar(128),
    duration_formula_key varchar(128),
    CONSTRAINT pk_provider_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_provider_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.event_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    event_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    event_ref varchar(256),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_event_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_event_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.event_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    event_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    event_ref varchar(256),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT pk_event_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_event_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.ability_control_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    action_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_ability_id varchar(256) NOT NULL,
    amount_formula_key varchar(128),
    value_policy_type_id int REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_control_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_ability_control_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.ability_control_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    action_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_ability_id varchar(256) NOT NULL,
    amount_formula_key varchar(128),
    value_policy_type_id int REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_ability_control_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_ability_control_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);



CREATE TABLE IF NOT EXISTS public.state_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    state_scope_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    state_key varchar(128) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_state_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_state_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.state_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    state_scope_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    state_key varchar(128) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_state_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_state_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);




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

    IF to_regclass('public.game_data_state') IS NOT NULL THEN
        INSERT INTO public.game_data_state (game_id, current_revision, published_revision, updated_at)
        SELECT g.game_id, 0, 0, NOW()
          FROM public.games g
         WHERE NOT EXISTS (
               SELECT 1 FROM public.game_data_state s WHERE s.game_id = g.game_id
         )
        ON CONFLICT (game_id) DO NOTHING;
    END IF;
END;
$$;

-- NOTE: After applying this migration on an existing DB, re-run
-- db/game_manage/triggers.sql so ensure_game_partitions covers new parents
-- and effect-detail deferred constraint triggers are installed.
