-- 只读：当前图片关联完整性检查（包含符文及分组）。结果应为零行；不自动删除或修复。
-- 固定来源种类和来源标识均按共享契约检查。
WITH sources AS (
    SELECT game_id, 'GAME'::text AS source_type, ''::text AS source_parent_key, game_id AS source_key FROM public.games
    UNION ALL SELECT game_id, 'CHARACTER', '', character_key FROM public.characters
    UNION ALL SELECT game_id, 'ATTRIBUTE', '', attribute_key FROM public.attributes
    UNION ALL SELECT game_id, 'EQUIPMENT', '', equipment_key FROM public.equipment
    UNION ALL SELECT game_id, 'SKILL', '', skill_key FROM public.skills
    UNION ALL SELECT game_id, 'SKILL_EFFECT', skill_key, effect_key FROM public.skill_effects
    UNION ALL SELECT game_id, 'STATUS', '', status_key FROM public.statuses
    UNION ALL SELECT game_id, 'RUNE', '', rune_key FROM public.runes
    UNION ALL SELECT game_id, 'RUNE_PATH', '', path_key FROM public.rune_paths
)
SELECT r.game_id, r.source_type, r.source_parent_key, r.source_key, r.image_key,
       (g.game_id IS NULL) AS missing_game,
       (s.source_key IS NULL) AS missing_source_in_game,
       (i.image_key IS NULL) AS missing_image_in_game
FROM public.image_relations r
LEFT JOIN public.games g ON g.game_id = r.game_id
LEFT JOIN sources s ON s.game_id = r.game_id AND s.source_type = r.source_type
    AND s.source_parent_key = r.source_parent_key AND s.source_key = r.source_key
LEFT JOIN public.images i ON i.game_id = r.game_id AND i.image_key = r.image_key
WHERE g.game_id IS NULL OR s.source_key IS NULL OR i.image_key IS NULL
ORDER BY r.game_id, r.source_type, r.source_parent_key, r.source_key;
