-- 符文基础管理追加迁移，前置为当前 24 张聚合存储逻辑表。
-- 由调用方在已核对目标库的单事务内执行和验收，本文件不提交事务。
-- 仅新增三张空表并扩充图片来源检查；不修改或删除已有业务数据。
-- 先确认三张目标表不存在，重复执行应失败；新库直接使用 schema.sql。
CREATE TABLE public.runes (
    game_id varchar(64) NOT NULL,
    rune_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    category varchar(16) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_runes PRIMARY KEY (game_id, rune_key),
    CONSTRAINT fk_runes_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_runes_key CHECK (rune_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_runes_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_runes_description CHECK (description IS NULL OR length(description) <= 2000),
    CONSTRAINT ck_runes_category CHECK (category IN ('KEYSTONE', 'MINOR', 'SHARD'))
);
CREATE UNIQUE INDEX uq_runes_name ON public.runes (game_id, lower(btrim(name)));
COMMENT ON TABLE public.runes IS '符文及属性碎片身份；不保存玩家选择';

CREATE TABLE public.rune_paths (
    game_id varchar(64) NOT NULL,
    path_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    kind varchar(16) NOT NULL,
    sort_order integer NOT NULL,
    slots jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_rune_paths PRIMARY KEY (game_id, path_key),
    CONSTRAINT fk_rune_paths_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_rune_paths_key CHECK (path_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_rune_paths_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_rune_paths_description CHECK (description IS NULL OR length(description) <= 2000),
    CONSTRAINT ck_rune_paths_kind CHECK (kind IN ('RUNE_PATH', 'SHARD_GROUP')),
    CONSTRAINT ck_rune_paths_sort_order CHECK (sort_order >= 0),
    CONSTRAINT ck_rune_paths_slots CHECK (jsonb_typeof(slots) = 'array')
);
CREATE UNIQUE INDEX uq_rune_paths_name ON public.rune_paths (game_id, lower(btrim(name)));
COMMENT ON TABLE public.rune_paths IS '符文系或碎片组；slots 为有序槽位与选项的唯一来源';

CREATE TABLE public.rune_skill_relations (
    game_id varchar(64) NOT NULL,
    rune_key varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_rune_skill_relations PRIMARY KEY (game_id, rune_key, skill_key),
    CONSTRAINT fk_rune_skill_relations_rune FOREIGN KEY (game_id, rune_key)
        REFERENCES public.runes (game_id, rune_key) ON DELETE CASCADE,
    CONSTRAINT fk_rune_skill_relations_skill FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE RESTRICT,
    CONSTRAINT ck_rune_skill_relations_sort_order CHECK (sort_order >= 0)
);
CREATE INDEX ix_rune_skill_relations_skill
    ON public.rune_skill_relations (game_id, skill_key, rune_key);
COMMENT ON TABLE public.rune_skill_relations IS '符文挂载技能；删除符文只清挂载，保留共享技能';

ALTER TABLE public.image_relations
    DROP CONSTRAINT ck_image_relations_source_type,
    ADD CONSTRAINT ck_image_relations_source_type
        CHECK (source_type IN ('GAME', 'CHARACTER', 'ATTRIBUTE', 'EQUIPMENT', 'SKILL', 'SKILL_EFFECT', 'STATUS', 'RUNE', 'RUNE_PATH'));
