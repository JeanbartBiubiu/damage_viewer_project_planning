-- 角色属性改为稀疏 Map 后，清理由旧版本自动生成的全 0 默认 Map。
-- 只处理整个角色 Map 没有任何非 0 数值的记录；已有实际数值的角色不变。

UPDATE public.character_attributes AS ca
SET level_values = (
    SELECT jsonb_object_agg(level_entry.key, '{}'::jsonb)
    FROM jsonb_each(ca.level_values) AS level_entry
),
    updated_at = now()
WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_each(ca.level_values) AS level_entry
    CROSS JOIN LATERAL jsonb_each(level_entry.value) AS attribute_entry
    WHERE jsonb_typeof(attribute_entry.value) = 'number'
      AND attribute_entry.value <> '0'::jsonb
);
