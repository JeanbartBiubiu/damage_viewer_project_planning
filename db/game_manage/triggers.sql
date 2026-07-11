-- =============================================================================
-- Damage Viewer System - Database Schema V2 (Triggers / Functions)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_game_partitions(p_game_id varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar := p_game_id;
BEGIN
    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.heroes FOR VALUES IN (%L)',
            'heroes_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.skills FOR VALUES IN (%L)',
            'skills_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.items FOR VALUES IN (%L)',
            'items_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.attribute_definitions FOR VALUES IN (%L)',
            'attribute_definitions_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.attribute_definitions_log FOR VALUES IN (%L)',
            'attribute_definitions_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.images FOR VALUES IN (%L)',
            'images_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.types FOR VALUES IN (%L)',
            'types_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.types_log FOR VALUES IN (%L)',
            'types_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.type_relations FOR VALUES IN (%L)',
            'type_relations_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.type_relations_log FOR VALUES IN (%L)',
            'type_relations_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.heroes_log FOR VALUES IN (%L)',
            'heroes_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.skills_log FOR VALUES IN (%L)',
            'skills_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.items_log FOR VALUES IN (%L)',
            'items_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.item_stat_modifiers FOR VALUES IN (%L)',
            'item_stat_modifiers_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.item_stat_modifiers_log FOR VALUES IN (%L)',
            'item_stat_modifiers_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.formula_profiles FOR VALUES IN (%L)',
            'formula_profiles_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.formula_profiles_log FOR VALUES IN (%L)',
            'formula_profiles_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.formula_bindings FOR VALUES IN (%L)',
            'formula_bindings_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.formula_bindings_log FOR VALUES IN (%L)',
            'formula_bindings_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.coefficient_buckets FOR VALUES IN (%L)',
            'coefficient_buckets_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.coefficient_buckets_log FOR VALUES IN (%L)',
            'coefficient_buckets_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_action_control_rules FOR VALUES IN (%L)',
            'status_action_control_rules_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_action_control_rules_log FOR VALUES IN (%L)',
            'status_action_control_rules_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_definitions FOR VALUES IN (%L)',
            'status_definitions_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_definitions_log FOR VALUES IN (%L)',
            'status_definitions_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_modifier_groups FOR VALUES IN (%L)',
            'status_modifier_groups_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_modifier_groups_log FOR VALUES IN (%L)',
            'status_modifier_groups_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_attribute_modifiers FOR VALUES IN (%L)',
            'status_attribute_modifiers_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_attribute_modifiers_log FOR VALUES IN (%L)',
            'status_attribute_modifiers_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_periodic_hp_effects FOR VALUES IN (%L)',
            'status_periodic_hp_effects_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.status_periodic_hp_effects_log FOR VALUES IN (%L)',
            'status_periodic_hp_effects_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.control_state_profiles FOR VALUES IN (%L)',
            'control_state_profiles_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.control_state_profiles_log FOR VALUES IN (%L)',
            'control_state_profiles_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.skill_mounts FOR VALUES IN (%L)',
            'skill_mounts_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.skill_mounts_log FOR VALUES IN (%L)',
            'skill_mounts_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.wasm_catalog_sources FOR VALUES IN (%L)',
            'wasm_catalog_sources_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF public.wasm_catalog_sources_log FOR VALUES IN (%L)',
            'wasm_catalog_sources_log_' || v_game_id,
            v_game_id
        );
    EXCEPTION WHEN duplicate_table THEN
        NULL;
    END;
END;
$$;

COMMENT ON FUNCTION public.ensure_game_partitions(varchar) IS '为指定 game_id 创建各分区表（幂等）';

CREATE OR REPLACE FUNCTION public.trg_games_after_insert_create_partitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM public.ensure_game_partitions(NEW.game_id);
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_games_after_insert_create_partitions() IS 'games 插入后自动创建分区表';

DROP TRIGGER IF EXISTS trg_games_after_insert_create_partitions ON public.games;
CREATE TRIGGER trg_games_after_insert_create_partitions
AFTER INSERT ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.trg_games_after_insert_create_partitions();

DO $$
DECLARE
    v_game_id varchar;
BEGIN
    FOR v_game_id IN
        SELECT game_id
        FROM public.games
    LOOP
        PERFORM public.ensure_game_partitions(v_game_id);
    END LOOP;
END;
$$;
