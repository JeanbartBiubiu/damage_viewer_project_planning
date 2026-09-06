-- =============================================================================
-- Damage Viewer System - Database Schema V2 (Triggers / Functions)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_game_partitions(p_game_id varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
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
$$;

COMMENT ON FUNCTION public.ensure_game_partitions(varchar) IS '为指定 game_id 创建 images 子分区（幂等；缺失父表时跳过）';

CREATE OR REPLACE FUNCTION public.trg_games_after_insert_create_partitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM public.ensure_game_partitions(NEW.game_id);
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_games_after_insert_create_partitions() IS 'games 插入后自动创建图片分区';

DROP TRIGGER IF EXISTS trg_games_after_insert_create_partitions ON public.games;
CREATE TRIGGER trg_games_after_insert_create_partitions
AFTER INSERT ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.trg_games_after_insert_create_partitions();
