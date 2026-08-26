BEGIN;

CREATE TABLE IF NOT EXISTS public.skill_categories (
    game_id varchar(64) NOT NULL,
    skill_category_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    status varchar(16) NOT NULL DEFAULT 'ENABLED',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_categories PRIMARY KEY (game_id, skill_category_key),
    CONSTRAINT fk_skill_categories_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_skill_categories_key
        CHECK (skill_category_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_categories_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_categories_status CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_skill_categories_sort_order CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_categories_name
    ON public.skill_categories (game_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.damage_types (
    game_id varchar(64) NOT NULL,
    damage_type_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    status varchar(16) NOT NULL DEFAULT 'ENABLED',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_damage_types PRIMARY KEY (game_id, damage_type_key),
    CONSTRAINT fk_damage_types_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_damage_types_key
        CHECK (damage_type_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_damage_types_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_damage_types_status CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_damage_types_sort_order CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_damage_types_name
    ON public.damage_types (game_id, lower(btrim(name)));

COMMENT ON TABLE public.skill_categories IS '技能分类';
COMMENT ON TABLE public.damage_types IS '伤害类型';

COMMIT;
