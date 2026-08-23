-- 角色基本管理：等级配置、角色和角色等级属性。
-- 该脚本只新增独立表，不迁移或删除旧实体、战斗数据。

CREATE TABLE IF NOT EXISTS public.game_level_configs (
    game_id varchar(64) NOT NULL,
    min_level integer NOT NULL,
    max_level integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_game_level_configs PRIMARY KEY (game_id),
    CONSTRAINT fk_game_level_configs_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_game_level_configs_range
        CHECK (min_level >= 1 AND max_level >= min_level AND max_level <= 100)
);

CREATE TABLE IF NOT EXISTS public.characters (
    game_id varchar(64) NOT NULL,
    character_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_characters PRIMARY KEY (game_id, character_key),
    CONSTRAINT fk_characters_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_characters_key
        CHECK (character_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_characters_name
        CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_characters_name
    ON public.characters (game_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.character_attributes (
    game_id varchar(64) NOT NULL,
    character_key varchar(64) NOT NULL,
    level_values jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_character_attributes PRIMARY KEY (game_id, character_key),
    CONSTRAINT fk_character_attributes_character
        FOREIGN KEY (game_id, character_key)
        REFERENCES public.characters (game_id, character_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_character_attributes_level_values
        CHECK (jsonb_typeof(level_values) = 'object')
);

INSERT INTO public.game_level_configs (game_id, min_level, max_level)
SELECT 'lol', 1, 18
WHERE EXISTS (SELECT 1 FROM public.games WHERE game_id = 'lol')
ON CONFLICT (game_id) DO NOTHING;
