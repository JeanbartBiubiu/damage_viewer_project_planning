-- 阶段 9 一次性迁移：先核对目标和旧封面数据，再由维护者显式执行。
-- 仅用于阶段 8 已完成且尚未创建关联表的数据库；新库只执行 schema.sql。
-- 已有任意同名关系表时主动停止，避免把未知或部分结构当作正确结构。
-- 不自动清空或猜测旧封面。全部 DDL、封面回填和旧列删除在同一事务。
BEGIN;

DO $preflight$
BEGIN
    IF to_regclass('public.games') IS NULL OR to_regclass('public.images') IS NULL THEN
        RAISE EXCEPTION '阶段 9 迁移前置表不存在';
    END IF;
    IF to_regclass('public.character_skill_relations') IS NOT NULL
        OR to_regclass('public.equipment_skill_relations') IS NOT NULL
        OR to_regclass('public.image_relations') IS NOT NULL THEN
        RAISE EXCEPTION '已有阶段 9 同名表，停止迁移；请核对是否已经执行或存在部分结构';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'game_img_url') THEN
        RAISE EXCEPTION '旧封面列不存在，停止迁移；请核对实际阶段';
    END IF;
END
$preflight$;

LOCK TABLE public.games IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.images IN SHARE MODE;

-- 只输出游戏标识与可处理状态，不输出原网址或图片内容。
SELECT g.game_id,
       CASE WHEN g.game_img_url IS NULL OR btrim(g.game_img_url) = '' THEN 'EMPTY'
            WHEN i.image_key IS NOT NULL THEN 'MATCHED' ELSE 'UNRESOLVED' END AS migration_state
FROM public.games g
LEFT JOIN public.images i ON i.game_id = g.game_id AND i.image_key = g.game_img_url
ORDER BY g.game_id;

DO $validate$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.games g
        WHERE g.game_img_url IS NOT NULL AND btrim(g.game_img_url) <> ''
          AND NOT EXISTS (SELECT 1 FROM public.images i
              WHERE i.game_id = g.game_id AND i.image_key = g.game_img_url)
    ) THEN
        RAISE EXCEPTION '存在无法精确对应同游戏图片标识的旧封面，请先明确映射或清空授权';
    END IF;
END
$validate$;

-- 阶段 9：角色、装备的技能挂载和七类代表图片。
CREATE TABLE public.character_skill_relations (
    game_id varchar(64) NOT NULL,
    character_key varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_character_skill_relations PRIMARY KEY (game_id, character_key, skill_key),
    CONSTRAINT fk_character_skill_relations_character FOREIGN KEY (game_id, character_key)
        REFERENCES public.characters (game_id, character_key) ON DELETE CASCADE,
    CONSTRAINT fk_character_skill_relations_skill FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE RESTRICT,
    CONSTRAINT ck_character_skill_relations_sort_order CHECK (sort_order >= 0)
);
CREATE INDEX ix_character_skill_relations_skill
    ON public.character_skill_relations (skill_key, game_id, character_key);
COMMENT ON TABLE public.character_skill_relations IS '角色挂载技能';

CREATE TABLE public.equipment_skill_relations (
    game_id varchar(64) NOT NULL,
    equipment_key varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_equipment_skill_relations PRIMARY KEY (game_id, equipment_key, skill_key),
    CONSTRAINT fk_equipment_skill_relations_equipment FOREIGN KEY (game_id, equipment_key)
        REFERENCES public.equipment (game_id, equipment_key) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_skill_relations_skill FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE RESTRICT,
    CONSTRAINT ck_equipment_skill_relations_sort_order CHECK (sort_order >= 0)
);
CREATE INDEX ix_equipment_skill_relations_skill
    ON public.equipment_skill_relations (skill_key, game_id, equipment_key);
COMMENT ON TABLE public.equipment_skill_relations IS '装备挂载技能';

CREATE TABLE public.image_relations (
    game_id varchar(64) NOT NULL,
    source_type varchar(16) NOT NULL,
    source_parent_key varchar(64) NOT NULL,
    source_key varchar(64) NOT NULL,
    image_key varchar(128) NOT NULL,
    CONSTRAINT pk_image_relations PRIMARY KEY (game_id, source_type, source_parent_key, source_key),
    CONSTRAINT ck_image_relations_source_type
        CHECK (source_type IN ('GAME', 'CHARACTER', 'ATTRIBUTE', 'EQUIPMENT', 'SKILL', 'SKILL_EFFECT', 'STATUS')),
    CONSTRAINT ck_image_relations_parent
        CHECK ((source_type = 'SKILL_EFFECT' AND btrim(source_parent_key) <> '')
            OR (source_type <> 'SKILL_EFFECT' AND source_parent_key = '')),
    CONSTRAINT ck_image_relations_source_key CHECK (btrim(source_key) <> ''),
    CONSTRAINT ck_image_relations_game CHECK (source_type <> 'GAME' OR source_key = game_id),
    CONSTRAINT ck_image_relations_image_key CHECK (btrim(image_key) <> '')
);
CREATE INDEX ix_image_relations_image ON public.image_relations (game_id, image_key, source_type);
COMMENT ON TABLE public.image_relations IS '代表图片关联；无外键，由后端校验存在性并在来源删除时清理';

INSERT INTO public.image_relations (game_id, source_type, source_parent_key, source_key, image_key)
SELECT g.game_id, 'GAME', '', g.game_id, g.game_img_url
FROM public.games g
WHERE g.game_img_url IS NOT NULL AND btrim(g.game_img_url) <> '';

DO $verify$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.games g
        LEFT JOIN public.image_relations r
            ON r.game_id = g.game_id AND r.source_type = 'GAME'
            AND r.source_parent_key = '' AND r.source_key = g.game_id
        WHERE (g.game_img_url IS NOT NULL AND btrim(g.game_img_url) <> ''
            AND r.image_key IS DISTINCT FROM g.game_img_url)
           OR ((g.game_img_url IS NULL OR btrim(g.game_img_url) = '') AND r.image_key IS NOT NULL)
    ) THEN
        RAISE EXCEPTION '游戏封面回填读回不一致，迁移回滚';
    END IF;
END
$verify$;

ALTER TABLE public.games DROP COLUMN game_img_url;
COMMIT;
