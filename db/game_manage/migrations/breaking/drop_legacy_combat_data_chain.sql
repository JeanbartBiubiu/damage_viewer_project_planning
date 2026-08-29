-- Breaking cleanup for the retired combat-data / version-publish chain.
-- Run manually only after the exact database target, row counts, and backup are confirmed.
-- Repeatable. Does not use dependency-propagating drop options. Does not recreate dropped objects or rewrite retained data.

BEGIN;

SELECT pg_advisory_xact_lock(74100445, 7445);

DO $$
DECLARE
    v_keep_parents text[] := ARRAY[
        'games',
        'attributes',
        'game_level_configs',
        'characters',
        'character_attributes',
        'equipment',
        'equipment_attributes',
        'skill_categories',
        'skills',
        'skill_category_relations',
        'skill_parameters',
        'skill_formulas',
        'skill_formula_nodes',
        'damage_types',
        'statuses',
        'skill_effects',
        'skill_effect_results',
        'skill_effect_result_values',
        'skill_effect_damage_details',
        'skill_effect_attribute_change_details',
        'skill_effect_resource_change_details',
        'skill_effect_cooldown_change_details',
        'skill_effect_status_operation_details',
        'skill_effect_lifecycles',
        'skill_effect_result_lifecycle_behaviors',
        'skill_effect_lifecycle_operation_details',
        'skill_internal_states',
        'skill_internal_state_counter_details',
        'skill_internal_state_ammo_details',
        'skill_internal_state_flag_details',
        'skill_internal_state_cooldown_details',
        'skill_internal_state_mode_options',
        'skill_processes',
        'skill_process_steps',
        'skill_process_delay_step_details',
        'skill_process_multi_hit_step_details',
        'skill_process_periodic_step_details',
        'skill_process_channel_step_details',
        'skill_process_charge_step_details',
        'skill_process_recast_step_details',
        'skill_process_empowered_attack_step_details',
        'skill_process_cooldowns',
        'skill_process_effect_bindings',
        'skill_process_state_operations',
        'images'
    ];
    v_drop_parents text[] := ARRAY[
        'execute_effect_details',
        'repeat_effect_details',
        'state_effect_details',
        'ability_control_effect_details',
        'event_effect_details',
        'provider_effect_details',
        'shield_effect_details',
        'attribute_effect_details',
        'heal_effect_details',
        'damage_effect_details',
        'listener_effect_sequences',
        'listener_match_types',
        'ability_phase_effect_sequences',
        'ability_cooldowns',
        'provider_tick_sequences',
        'effect_steps',
        'provider_listeners',
        'ability_phases',
        'ability_state_fields',
        'ability_parameters',
        'provider_lifecycles',
        'entity_attribute_stage_values',
        'effect_sequences',
        'provider_modifiers',
        'ability_definitions',
        'provider_state_fields',
        'entity_provider_mounts',
        'provider_formulas',
        'entity_attribute_values',
        'repeat_effect_details_log',
        'state_effect_details_log',
        'ability_control_effect_details_log',
        'event_effect_details_log',
        'provider_effect_details_log',
        'shield_effect_details_log',
        'attribute_effect_details_log',
        'heal_effect_details_log',
        'damage_effect_details_log',
        'ability_phase_effect_sequences_log',
        'effect_steps_log',
        'listener_match_types_log',
        'provider_listeners_log',
        'provider_modifiers_log',
        'ability_phases_log',
        'ability_state_fields_log',
        'ability_definitions_log',
        'provider_state_fields_log',
        'provider_lifecycles_log',
        'provider_definitions_log',
        'provider_definitions',
        'types_log',
        'types',
        'reserved_type_relation',
        'execute_effect_details_log',
        'provider_tick_sequences_log',
        'listener_effect_sequences_log',
        'effect_sequences_log',
        'ability_cooldowns_log',
        'ability_parameters_log',
        'entity_provider_mounts_log',
        'provider_formulas_log',
        'entity_attribute_stage_values_log',
        'entity_attribute_values_log',
        'game_entities_log',
        'type_relations_log',
        'attribute_definitions_log',
        'game_progression_schema_log',
        'game_entities',
        'type_relations',
        'reserved_type',
        'attribute_definitions',
        'game_progression_schema',
        'game_versions',
        'game_data_state'
    ];
    v_legacy_triggers text[] := ARRAY[
        'trg_effect_steps_exactly_one_detail',
        'trg_damage_effect_details_exactly_one_detail',
        'trg_heal_effect_details_exactly_one_detail',
        'trg_attribute_effect_details_exactly_one_detail',
        'trg_shield_effect_details_exactly_one_detail',
        'trg_provider_effect_details_exactly_one_detail',
        'trg_event_effect_details_exactly_one_detail',
        'trg_ability_control_effect_details_exactly_one_detail',
        'trg_state_effect_details_exactly_one_detail',
        'trg_repeat_effect_details_exactly_one_detail',
        'trg_execute_effect_details_exactly_one_detail'
    ];
    v_legacy_trigger_tables text[] := ARRAY[
        'effect_steps',
        'damage_effect_details',
        'heal_effect_details',
        'attribute_effect_details',
        'shield_effect_details',
        'provider_effect_details',
        'event_effect_details',
        'ability_control_effect_details',
        'state_effect_details',
        'repeat_effect_details',
        'execute_effect_details'
    ];
    v_table text;
    v_partkey text;
    v_relkind "char";
    v_idx int;
    v_unknown text;
    v_child text;
    v_game_id varchar;
BEGIN
    IF array_length(v_keep_parents, 1) IS DISTINCT FROM 45 THEN
        RAISE EXCEPTION 'keep parent list must contain exactly 45 names';
    END IF;
    IF array_length(v_drop_parents, 1) IS DISTINCT FROM 74 THEN
        RAISE EXCEPTION 'drop parent list must contain exactly 74 names';
    END IF;

    FOREACH v_table IN ARRAY v_keep_parents
    LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE EXCEPTION 'required parent table public.% is missing', v_table;
        END IF;
    END LOOP;

    SELECT c.relkind, pg_get_partkeydef(c.oid)
      INTO v_relkind, v_partkey
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relname = 'images';

    IF v_relkind IS DISTINCT FROM 'p' OR v_partkey IS DISTINCT FROM 'LIST (game_id)' THEN
        RAISE EXCEPTION
            'images must be PARTITION BY LIST (game_id); found relkind=% partkey=%',
            v_relkind, v_partkey;
    END IF;

    CREATE TEMP TABLE tmp_legacy_closure (
        classid oid NOT NULL,
        objid oid NOT NULL,
        PRIMARY KEY (classid, objid)
    ) ON COMMIT DROP;

    CREATE TEMP TABLE tmp_legacy_child_relnames (
        relname text PRIMARY KEY
    ) ON COMMIT DROP;

    -- 74 explicit parents that still exist. Identity is (pg_class, relation oid).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_class'::regclass, c.oid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relname = ANY (v_drop_parents)
    ON CONFLICT DO NOTHING;

    -- Runtime subpartitions via pg_inherits, not by name prefix.
    -- Recursion starts only from pg_class members of the closure.
    WITH RECURSIVE parts AS (
        SELECT i.inhrelid AS oid
          FROM pg_inherits i
          JOIN tmp_legacy_closure p
            ON p.classid = 'pg_class'::regclass
           AND p.objid = i.inhparent
        UNION
        SELECT i.inhrelid
          FROM pg_inherits i
          JOIN parts p ON p.oid = i.inhparent
    )
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_class'::regclass, oid FROM parts
    ON CONFLICT DO NOTHING;

    INSERT INTO tmp_legacy_child_relnames(relname)
    SELECT c.relname
      FROM tmp_legacy_closure o
      JOIN pg_class c
        ON o.classid = 'pg_class'::regclass
       AND c.oid = o.objid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE NOT (c.relname = ANY (v_drop_parents))
    ON CONFLICT DO NOTHING;

    -- TOAST tables of closure relations (pg_class).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_class'::regclass, c.reltoastrelid
      FROM pg_class c
      JOIN tmp_legacy_closure o
        ON o.classid = 'pg_class'::regclass
       AND o.objid = c.oid
     WHERE c.reltoastrelid <> 0
    ON CONFLICT DO NOTHING;

    -- Indexes, including TOAST indexes (pg_class).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_class'::regclass, i.indexrelid
      FROM pg_index i
      JOIN tmp_legacy_closure o
        ON o.classid = 'pg_class'::regclass
       AND o.objid = i.indrelid
    ON CONFLICT DO NOTHING;

    -- Sequences owned by closure relations (pg_class).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_class'::regclass, s.oid
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass
      JOIN tmp_legacy_closure o
        ON o.classid = d.refclassid
       AND o.objid = d.refobjid
     WHERE s.relkind = 'S'
    ON CONFLICT DO NOTHING;

    -- Composite/row types generated for closure relations (pg_type).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_type'::regclass, t.oid
      FROM pg_type t
      JOIN tmp_legacy_closure o
        ON o.classid = 'pg_class'::regclass
       AND o.objid = t.typrelid
    ON CONFLICT DO NOTHING;

    -- Constraints that live on closure relations (pg_constraint).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_constraint'::regclass, c.oid
      FROM pg_constraint c
      JOIN tmp_legacy_closure o
        ON o.classid = 'pg_class'::regclass
       AND o.objid = c.conrelid
    ON CONFLICT DO NOTHING;

    -- Triggers on closure relations, including parents and runtime partitions (pg_trigger).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_trigger'::regclass, tg.oid
      FROM pg_trigger tg
      JOIN tmp_legacy_closure o
        ON o.classid = 'pg_class'::regclass
       AND o.objid = tg.tgrelid
    ON CONFLICT DO NOTHING;

    -- Internal FK triggers whose tgconstraint points at a closure constraint (pg_trigger).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_trigger'::regclass, tg.oid
      FROM pg_trigger tg
      JOIN tmp_legacy_closure o
        ON o.classid = 'pg_constraint'::regclass
       AND o.objid = tg.tgconstraint
     WHERE tg.tgconstraint <> 0
    ON CONFLICT DO NOTHING;

    -- ensure_game_data_state(varchar) and the two legacy effect-step functions (pg_proc).
    INSERT INTO tmp_legacy_closure(classid, objid)
    SELECT 'pg_proc'::regclass, p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE (p.proname = 'ensure_game_data_state' AND p.pronargs = 1)
        OR (p.proname = 'count_effect_step_details' AND p.pronargs = 2)
        OR (p.proname = 'trg_effect_step_exactly_one_detail' AND p.pronargs = 0)
    ON CONFLICT DO NOTHING;

    -- Fail closed on outside tables / views / matviews / triggers / functions.
    -- Rewrite-target trg_games_after_insert_create_partitions() may still depend
    -- on ensure_game_data_state until the CREATE OR REPLACE below.
    SELECT string_agg(format('%s %s depends on %s', kind, obj_name, ref_name), '; ' ORDER BY obj_name)
      INTO v_unknown
      FROM (
        SELECT DISTINCT
            CASE
                WHEN d.classid = 'pg_class'::regclass AND cls.relkind IN ('r', 'p') THEN 'table'
                WHEN d.classid = 'pg_class'::regclass AND cls.relkind = 'v' THEN 'view'
                WHEN d.classid = 'pg_class'::regclass AND cls.relkind = 'm' THEN 'matview'
                WHEN d.classid = 'pg_proc'::regclass THEN 'function'
                WHEN d.classid = 'pg_trigger'::regclass THEN 'trigger'
                WHEN d.classid = 'pg_rewrite'::regclass THEN 'rewrite'
            END AS kind,
            CASE
                WHEN d.classid = 'pg_class'::regclass THEN format('%I.%I', cn.nspname, cls.relname)
                WHEN d.classid = 'pg_proc'::regclass THEN format('%I.%I(%s)', pn.nspname, proc.proname, pg_get_function_identity_arguments(proc.oid))
                WHEN d.classid = 'pg_trigger'::regclass THEN format('%I.%I.%I', tn.nspname, trel.relname, trig.tgname)
                WHEN d.classid = 'pg_rewrite'::regclass THEN format('%I.%I', rn.nspname, rrel.relname)
            END AS obj_name,
            CASE
                WHEN d.refclassid = 'pg_class'::regclass THEN format('%I.%I', rcn.nspname, rcls.relname)
                WHEN d.refclassid = 'pg_proc'::regclass THEN format('%I.%I(%s)', rpn.nspname, rproc.proname, pg_get_function_identity_arguments(rproc.oid))
                WHEN d.refclassid = 'pg_trigger'::regclass THEN format('%I', rtrig.tgname)
                ELSE d.refobjid::text
            END AS ref_name
          FROM pg_depend d
          LEFT JOIN pg_class cls ON d.classid = 'pg_class'::regclass AND cls.oid = d.objid
          LEFT JOIN pg_namespace cn ON cn.oid = cls.relnamespace
          LEFT JOIN pg_proc proc ON d.classid = 'pg_proc'::regclass AND proc.oid = d.objid
          LEFT JOIN pg_namespace pn ON pn.oid = proc.pronamespace
          LEFT JOIN pg_trigger trig ON d.classid = 'pg_trigger'::regclass AND trig.oid = d.objid
          LEFT JOIN pg_class trel ON trel.oid = trig.tgrelid
          LEFT JOIN pg_namespace tn ON tn.oid = trel.relnamespace
          LEFT JOIN pg_rewrite rw ON d.classid = 'pg_rewrite'::regclass AND rw.oid = d.objid
          LEFT JOIN pg_class rrel ON rrel.oid = rw.ev_class
          LEFT JOIN pg_namespace rn ON rn.oid = rrel.relnamespace
          LEFT JOIN pg_class rcls ON d.refclassid = 'pg_class'::regclass AND rcls.oid = d.refobjid
          LEFT JOIN pg_namespace rcn ON rcn.oid = rcls.relnamespace
          LEFT JOIN pg_proc rproc ON d.refclassid = 'pg_proc'::regclass AND rproc.oid = d.refobjid
          LEFT JOIN pg_namespace rpn ON rpn.oid = rproc.pronamespace
          LEFT JOIN pg_trigger rtrig ON d.refclassid = 'pg_trigger'::regclass AND rtrig.oid = d.refobjid
         WHERE d.deptype IN ('n', 'a', 'i')
           AND EXISTS (
                SELECT 1
                  FROM tmp_legacy_closure ref
                 WHERE ref.classid = d.refclassid
                   AND ref.objid = d.refobjid
           )
           AND NOT EXISTS (
                SELECT 1
                  FROM tmp_legacy_closure obj
                 WHERE obj.classid = d.classid
                   AND obj.objid = d.objid
           )
           AND (
                (d.classid = 'pg_class'::regclass AND cls.relkind IN ('r', 'p', 'v', 'm'))
                OR d.classid = 'pg_proc'::regclass
                OR d.classid = 'pg_trigger'::regclass
                OR d.classid = 'pg_rewrite'::regclass
           )
           AND NOT (
                d.classid = 'pg_proc'::regclass
                AND pn.nspname = 'public'
                AND proc.proname = 'trg_games_after_insert_create_partitions'
                AND proc.pronargs = 0
                AND d.refclassid = 'pg_proc'::regclass
                AND rpn.nspname = 'public'
                AND rproc.proname = 'ensure_game_data_state'
           )
      ) deps
     WHERE kind IS NOT NULL;

    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'legacy DROP aborted: outside-closure dependency: %', v_unknown;
    END IF;

    -- Also fail if a retained table holds an FK onto the drop set.
    SELECT string_agg(format('%I.%I.%I -> %I.%I', nsrc.nspname, src.relname, c.conname, ntgt.nspname, tgt.relname), '; ')
      INTO v_unknown
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace nsrc ON nsrc.oid = src.relnamespace
      JOIN pg_class tgt ON tgt.oid = c.confrelid
      JOIN pg_namespace ntgt ON ntgt.oid = tgt.relnamespace
     WHERE c.contype = 'f'
       AND EXISTS (
            SELECT 1
              FROM tmp_legacy_closure tgt_c
             WHERE tgt_c.classid = 'pg_class'::regclass
               AND tgt_c.objid = tgt.oid
       )
       AND NOT EXISTS (
            SELECT 1
              FROM tmp_legacy_closure src_c
             WHERE src_c.classid = 'pg_class'::regclass
               AND src_c.objid = src.oid
       );

    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'legacy DROP aborted: foreign key from outside the drop set: %', v_unknown;
    END IF;

    -- Rewrite retained image-partition helpers, then drop the old state function.
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.ensure_game_partitions(p_game_id varchar)
RETURNS void
LANGUAGE plpgsql
AS $body$
DECLARE
    v_game_id varchar := p_game_id;
    v_parent text;
    v_parents text[] := ARRAY[
        'images'
    ];
BEGIN
    FOREACH v_parent IN ARRAY v_parents
    LOOP
        IF to_regclass('public.' || v_parent) IS NULL THEN
            CONTINUE;
        END IF;
        BEGIN
            EXECUTE format(
                'CREATE TABLE %I PARTITION OF public.%I FOR VALUES IN (%L)',
                v_parent || '_' || v_game_id,
                v_parent,
                v_game_id
            );
        EXCEPTION WHEN duplicate_table THEN
            NULL;
        END;
    END LOOP;
END;
$body$;
$fn$;

    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.trg_games_after_insert_create_partitions()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
    PERFORM public.ensure_game_partitions(NEW.game_id);
    RETURN NEW;
END;
$body$;
$fn$;

    COMMENT ON FUNCTION public.ensure_game_partitions(varchar) IS
        '为指定 game_id 创建 images 子分区（幂等；缺失父表时跳过）';
    COMMENT ON FUNCTION public.trg_games_after_insert_create_partitions() IS
        'games 插入后自动创建图片分区';

    DROP FUNCTION IF EXISTS public.ensure_game_data_state(varchar);

    -- Eleven named effect-step triggers, then the two functions.
    FOR v_idx IN 1 .. array_length(v_legacy_triggers, 1)
    LOOP
        v_table := v_legacy_trigger_tables[v_idx];
        IF to_regclass('public.' || v_table) IS NOT NULL THEN
            EXECUTE format(
                'DROP TRIGGER IF EXISTS %I ON public.%I',
                v_legacy_triggers[v_idx],
                v_table
            );
        END IF;
    END LOOP;

    DROP FUNCTION IF EXISTS public.trg_effect_step_exactly_one_detail();
    DROP FUNCTION IF EXISTS public.count_effect_step_details(varchar, varchar);

    -- Explicit parent names only; never prefix-match. Does not use dependency-propagating drop options.
    FOREACH v_table IN ARRAY v_drop_parents
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I', v_table);
    END LOOP;

    SELECT string_agg(relname, ', ' ORDER BY relname)
      INTO v_unknown
      FROM tmp_legacy_child_relnames
     WHERE to_regclass('public.' || relname) IS NOT NULL;

    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'legacy DROP aborted: orphan partition remains: %', v_unknown;
    END IF;

    FOR v_game_id IN
        SELECT game_id FROM public.games
    LOOP
        PERFORM public.ensure_game_partitions(v_game_id);
    END LOOP;
END;
$$;

COMMIT;
