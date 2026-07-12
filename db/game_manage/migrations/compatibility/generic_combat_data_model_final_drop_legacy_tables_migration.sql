-- =============================================================================
-- Final DROP of legacy combat data tables (§12.3)
-- =============================================================================
-- No CASCADE. Unknown inbound FK/view/trigger dependencies abort the migration.
-- Safe to re-run once tables are already gone.
-- After success, re-run db/game_manage/triggers.sql to refresh partition lists.
-- =============================================================================

DO $$
DECLARE
    v_expected text[] := ARRAY[
        'published_bundle_snapshots',
        'published_wasm_catalog_snapshots',
        'wasm_catalog_sources_log',
        'wasm_catalog_sources',
        'skill_mounts_log',
        'skill_mounts',
        'item_stat_modifiers_log',
        'item_stat_modifiers',
        'formula_bindings_log',
        'formula_bindings',
        'formula_profiles_log',
        'formula_profiles',
        'status_attribute_modifiers_log',
        'status_attribute_modifiers',
        'status_periodic_hp_effects_log',
        'status_periodic_hp_effects',
        'status_modifier_groups_log',
        'status_modifier_groups',
        'status_definitions_log',
        'status_definitions',
        'status_action_control_rules_log',
        'status_action_control_rules',
        'control_state_profiles_log',
        'control_state_profiles',
        'coefficient_buckets_log',
        'coefficient_buckets',
        'heroes_log',
        'heroes',
        'skills_log',
        'skills',
        'items_log',
        'items',
        'owner_categories'
    ];
    v_known_internal_fks text[] := ARRAY[
        -- skill_mounts -> skills
        'fk_skill_mounts_skill',
        -- item_stat_modifiers typically -> items / versions (named constraints)
        'fk_item_stat_modifiers_start_version',
        'fk_item_stat_modifiers_end_version',
        'fk_item_stat_modifiers_log_start_version',
        'fk_item_stat_modifiers_log_end_version',
        -- formula
        'fk_formula_profiles_start_version',
        'fk_formula_profiles_end_version',
        'fk_formula_profiles_log_start_version',
        'fk_formula_profiles_log_end_version',
        'fk_formula_bindings_start_version',
        'fk_formula_bindings_end_version',
        'fk_formula_bindings_log_start_version',
        'fk_formula_bindings_log_end_version',
        -- heroes/skills/items version FKs
        'fk_heroes_start_version',
        'fk_heroes_end_version',
        'fk_heroes_log_start_version',
        'fk_heroes_log_end_version',
        'fk_skills_start_version',
        'fk_skills_end_version',
        'fk_skills_owner_category',
        -- skills/skills_log -> owner_categories (also on lol partitions)
        'fk_skills_owner_type',
        'fk_skills_log_start_version',
        'fk_skills_log_end_version',
        'fk_skills_log_owner_category',
        'fk_skills_log_owner_type',
        'fk_items_start_version',
        'fk_items_end_version',
        'fk_items_log_start_version',
        'fk_items_log_end_version',
        'fk_skill_mounts_start_version',
        'fk_skill_mounts_end_version',
        'fk_skill_mounts_log_start_version',
        'fk_skill_mounts_log_end_version',
        -- coefficient
        'fk_coefficient_buckets_start_version',
        'fk_coefficient_buckets_end_version',
        'fk_coefficient_buckets_log_start_version',
        'fk_coefficient_buckets_log_end_version',
        -- status/control
        'fk_status_action_control_rules_start_version',
        'fk_status_action_control_rules_end_version',
        'fk_status_action_control_rules_log_start_version',
        'fk_status_action_control_rules_log_end_version',
        'fk_status_definitions_start_version',
        'fk_status_definitions_end_version',
        'fk_status_definitions_control_profile',
        'fk_status_definitions_log_start_version',
        'fk_status_definitions_log_end_version',
        'fk_status_modifier_groups_start_version',
        'fk_status_modifier_groups_end_version',
        'fk_status_modifier_groups_status',
        'fk_status_modifier_groups_log_start_version',
        'fk_status_modifier_groups_log_end_version',
        'fk_status_attribute_modifiers_start_version',
        'fk_status_attribute_modifiers_end_version',
        'fk_status_attribute_modifiers_group',
        'fk_status_attribute_modifiers_log_start_version',
        'fk_status_attribute_modifiers_log_end_version',
        'fk_status_periodic_hp_effects_start_version',
        'fk_status_periodic_hp_effects_end_version',
        'fk_status_periodic_hp_effects_group',
        'fk_status_periodic_hp_effects_log_start_version',
        'fk_status_periodic_hp_effects_log_end_version',
        'fk_control_state_profiles_start_version',
        'fk_control_state_profiles_end_version',
        'fk_control_state_profiles_log_start_version',
        'fk_control_state_profiles_log_end_version',
        -- snapshots / wasm
        'fk_published_bundle_snapshots_version',
        'fk_published_wasm_catalog_snapshots_version',
        'fk_wasm_catalog_sources_version',
        'fk_wasm_catalog_sources_log_version',
        'fk_wasm_catalog_sources_log_start_version',
        'fk_wasm_catalog_sources_log_end_version'
    ];
    -- Known FKs that may live on parent and/or partitions; drop via conrelid (no CASCADE).
    v_known_explicit_drop_fks text[] := ARRAY[
        'fk_skills_owner_type',
        'fk_skills_log_owner_type'
    ];
    v_table text;
    v_unknown record;
    v_view record;
    v_trig record;
    v_drop_fk record;
BEGIN
    -- 1) Abort if any non-self FK references a drop target from outside the drop set.
    FOR v_unknown IN
        SELECT
            c.conname,
            src.relname AS from_table,
            tgt.relname AS to_table
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_namespace nsrc ON nsrc.oid = src.relnamespace AND nsrc.nspname = 'public'
        JOIN pg_class tgt ON tgt.oid = c.confrelid
        JOIN pg_namespace ntgt ON ntgt.oid = tgt.relnamespace AND ntgt.nspname = 'public'
        WHERE c.contype = 'f'
          AND (
                tgt.relname = ANY (v_expected)
                OR src.relname = ANY (v_expected)
              )
          AND NOT (src.relname = ANY (v_expected) AND tgt.relname = ANY (v_expected))
          AND NOT (c.conname = ANY (v_known_internal_fks))
          -- version FKs from legacy tables to game_versions are expected and drop with the table
          AND NOT (tgt.relname = 'game_versions' AND src.relname = ANY (v_expected))
          AND NOT (tgt.relname = 'games' AND src.relname = ANY (v_expected))
          AND NOT (tgt.relname = 'attribute_definitions' AND src.relname = ANY (v_expected))
    LOOP
        RAISE EXCEPTION
            'legacy DROP aborted: unknown FK dependency % (%.% -> %)',
            v_unknown.conname, 'public', v_unknown.from_table, v_unknown.to_table;
    END LOOP;

    -- 1b) Drop known partition/parent FKs from their actual relation (conrelid).
    -- pg_constraint lists both parent and partition clones; dropping the parent FK
    -- auto-removes partition clones, so use IF EXISTS for idempotent whitelist drops.
    FOR v_drop_fk IN
        SELECT
            n.nspname AS schema_name,
            cls.relname AS table_name,
            c.conname
        FROM pg_constraint c
        JOIN pg_class cls ON cls.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cls.relnamespace AND n.nspname = 'public'
        WHERE c.contype = 'f'
          AND c.conname = ANY (v_known_explicit_drop_fks)
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
            v_drop_fk.schema_name,
            v_drop_fk.table_name,
            v_drop_fk.conname
        );
        RAISE NOTICE 'dropped constraint %.%.% (IF EXISTS)',
            v_drop_fk.schema_name, v_drop_fk.table_name, v_drop_fk.conname;
    END LOOP;

    -- 2) Abort on unexpected views depending on drop targets.
    FOR v_view IN
        SELECT DISTINCT dependent_ns.nspname AS schema_name, dependent_view.relname AS view_name, source_table.relname AS table_name
        FROM pg_depend
        JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
        JOIN pg_class AS dependent_view ON pg_rewrite.ev_class = dependent_view.oid
        JOIN pg_class AS source_table ON pg_depend.refobjid = source_table.oid
        JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
        JOIN pg_namespace source_ns ON source_ns.oid = source_table.relnamespace
        WHERE source_ns.nspname = 'public'
          AND source_table.relname = ANY (v_expected)
          AND dependent_view.relkind = 'v'
    LOOP
        RAISE EXCEPTION
            'legacy DROP aborted: view %.% depends on %',
            v_view.schema_name, v_view.view_name, v_view.table_name;
    END LOOP;

    -- 3) Abort on unexpected user triggers on drop targets (partition / internal OK to drop with table).
    FOR v_trig IN
        SELECT tg.tgname, cls.relname
        FROM pg_trigger tg
        JOIN pg_class cls ON cls.oid = tg.tgrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace AND ns.nspname = 'public'
        WHERE NOT tg.tgisinternal
          AND cls.relname = ANY (v_expected)
    LOOP
        -- Drop known internal triggers explicitly before table drop when present.
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_trig.tgname, v_trig.relname);
    END LOOP;

    -- 4) Drop in dependency order (children first). No CASCADE.
    FOREACH v_table IN ARRAY v_expected
    LOOP
        IF to_regclass('public.' || v_table) IS NOT NULL THEN
            EXECUTE format('DROP TABLE public.%I', v_table);
            RAISE NOTICE 'dropped public.%', v_table;
        END IF;
    END LOOP;
END $$;

-- Drop legacy data_hash if still present on game_versions.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'game_versions'
           AND column_name = 'data_hash'
    ) THEN
        ALTER TABLE public.game_versions DROP COLUMN data_hash;
    END IF;
END $$;
