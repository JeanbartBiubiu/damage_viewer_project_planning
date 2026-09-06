-- 只读：迁移前逐游戏分类。仅用于仍有 games.game_img_url 的阶段 8 数据库。
-- UNRESOLVED 必须先由负责人明确映射或清空处置；不输出原网址或图片内容。
SELECT g.game_id,
       CASE WHEN g.game_img_url IS NULL OR btrim(g.game_img_url) = '' THEN 'EMPTY'
            WHEN i.image_key IS NOT NULL THEN 'MATCHED' ELSE 'UNRESOLVED' END AS migration_state
FROM public.games g
LEFT JOIN public.images i ON i.game_id = g.game_id AND i.image_key = g.game_img_url
ORDER BY g.game_id;
