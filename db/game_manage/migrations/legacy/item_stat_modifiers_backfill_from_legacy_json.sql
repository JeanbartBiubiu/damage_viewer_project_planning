-- =============================================================================
-- Backfill item_stat_modifiers from legacy JSON column on public.items
-- =============================================================================
--
-- Legacy column detection priority:
-- 1) stats_modifier
-- 2) stat_modifiers
-- 3) stats_modifiers
--
-- Supported legacy JSON shapes:
-- - object: {"attr_key": number}
-- - array : [{"attrKey":"...","value":number}]

DROP TABLE IF EXISTS tmp_item_stat_modifiers_backfill_meta;
DROP TABLE IF EXISTS tmp_item_stat_modifiers_backfill_game_ids;
DROP TABLE IF EXISTS tmp_item_stat_modifiers_backfill;

DO $$
DECLARE
    v_legacy_col text;
BEGIN
    SELECT c.column_name
      INTO v_legacy_col
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'items'
       AND c.column_name IN ('stats_modifier', 'stat_modifiers', 'stats_modifiers')
     ORDER BY CASE c.column_name
                  WHEN 'stats_modifier' THEN 1
                  WHEN 'stat_modifiers' THEN 2
                  WHEN 'stats_modifiers' THEN 3
                  ELSE 99
              END
     LIMIT 1;

    IF v_legacy_col IS NULL THEN
        RAISE EXCEPTION
            'Legacy JSON column not found on public.items. Tried: stats_modifier, stat_modifiers, stats_modifiers.';
    END IF;

    CREATE TEMP TABLE tmp_item_stat_modifiers_backfill_meta (
        legacy_column text NOT NULL
    );

    INSERT INTO tmp_item_stat_modifiers_backfill_meta (legacy_column)
    VALUES (v_legacy_col);

    EXECUTE format($sql$
        CREATE TEMP TABLE tmp_item_stat_modifiers_backfill_game_ids AS
        SELECT DISTINCT i.game_id
        FROM public.items i
        WHERE i.%1$I IS NOT NULL
    $sql$, v_legacy_col);

    EXECUTE format($sql$
        CREATE TEMP TABLE tmp_item_stat_modifiers_backfill AS
        WITH src AS (
            SELECT
                i.game_id,
                i.item_id,
                i.start_version_id,
                i.end_version_id,
                i.updated_at,
                i.%1$I AS legacy_json
            FROM public.items i
            WHERE i.%1$I IS NOT NULL
        ),
        object_rows AS (
            SELECT
                s.game_id,
                s.item_id,
                s.start_version_id,
                s.end_version_id,
                s.updated_at,
                trim(lower(e.key)) AS attr_key,
                e.value AS raw_value,
                0::bigint AS ord
            FROM src s
            CROSS JOIN LATERAL jsonb_each(
                CASE
                    WHEN jsonb_typeof(s.legacy_json) = 'object' THEN s.legacy_json
                    ELSE '{}'::jsonb
                END
            ) AS e(key, value)
        ),
        array_rows AS (
            SELECT
                s.game_id,
                s.item_id,
                s.start_version_id,
                s.end_version_id,
                s.updated_at,
                trim(lower(a.elem ->> 'attrKey')) AS attr_key,
                a.elem -> 'value' AS raw_value,
                a.ord::bigint AS ord
            FROM src s
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(s.legacy_json) = 'array' THEN s.legacy_json
                    ELSE '[]'::jsonb
                END
            ) WITH ORDINALITY AS a(elem, ord)
        ),
        normalized AS (
            SELECT * FROM object_rows
            UNION ALL
            SELECT * FROM array_rows
        ),
        convertible AS (
            SELECT
                n.game_id,
                n.item_id,
                n.start_version_id,
                n.end_version_id,
                n.updated_at,
                n.attr_key,
                n.raw_value,
                n.ord
            FROM normalized n
            WHERE n.attr_key IS NOT NULL
              AND n.attr_key <> ''
              AND n.attr_key ~ '^[a-z0-9_\\.]+$'
              AND n.raw_value IS NOT NULL
              AND jsonb_typeof(n.raw_value) = 'number'
        ),
        dedup AS (
            SELECT DISTINCT ON (c.game_id, c.item_id, c.attr_key)
                c.game_id,
                c.item_id,
                c.attr_key,
                c.start_version_id,
                c.end_version_id,
                (c.raw_value::text)::numeric AS value,
                c.updated_at
            FROM convertible c
            ORDER BY
                c.game_id,
                c.item_id,
                c.attr_key,
                c.ord DESC
        )
        SELECT
            d.game_id,
            d.item_id,
            d.attr_key,
            d.start_version_id,
            d.end_version_id,
            d.value,
            d.updated_at
        FROM dedup d
    $sql$, v_legacy_col);

    PERFORM public.ensure_game_partitions(g.game_id)
    FROM tmp_item_stat_modifiers_backfill_game_ids g;

    INSERT INTO public.item_stat_modifiers (
        game_id,
        item_id,
        attr_key,
        start_version_id,
        end_version_id,
        value,
        updated_at
    )
    SELECT
        b.game_id,
        b.item_id,
        b.attr_key,
        b.start_version_id,
        b.end_version_id,
        b.value,
        COALESCE(b.updated_at, NOW())
    FROM tmp_item_stat_modifiers_backfill b
    ON CONFLICT (game_id, item_id, attr_key) DO UPDATE
    SET
        start_version_id = EXCLUDED.start_version_id,
        end_version_id = EXCLUDED.end_version_id,
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;
END
$$ LANGUAGE plpgsql;

-- 1) Stats: convertible legacy rows vs target rows present for matched keys.
WITH legacy_counts AS (
    SELECT COUNT(*) AS legacy_convertible_rows
    FROM tmp_item_stat_modifiers_backfill
),
target_counts AS (
    SELECT COUNT(*) AS target_rows_present
    FROM public.item_stat_modifiers t
    JOIN tmp_item_stat_modifiers_backfill b
      ON t.game_id = b.game_id
     AND t.item_id = b.item_id
     AND t.attr_key = b.attr_key
)
SELECT
    m.legacy_column AS detected_legacy_column,
    lc.legacy_convertible_rows,
    tc.target_rows_present
FROM tmp_item_stat_modifiers_backfill_meta m
CROSS JOIN legacy_counts lc
CROSS JOIN target_counts tc;

-- 2) Sample: 20 migrated rows.
SELECT
    t.game_id,
    t.item_id,
    t.attr_key,
    t.start_version_id,
    t.end_version_id,
    t.value,
    t.updated_at
FROM public.item_stat_modifiers t
JOIN tmp_item_stat_modifiers_backfill b
  ON t.game_id = b.game_id
 AND t.item_id = b.item_id
 AND t.attr_key = b.attr_key
ORDER BY t.updated_at DESC, t.game_id, t.item_id, t.attr_key
LIMIT 20;
