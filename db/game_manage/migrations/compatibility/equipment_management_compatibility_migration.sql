BEGIN;

CREATE TABLE IF NOT EXISTS public.equipment (
    game_id varchar(64) NOT NULL,
    equipment_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_equipment PRIMARY KEY (game_id, equipment_key),
    CONSTRAINT fk_equipment_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_equipment_key
        CHECK (equipment_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_equipment_name
        CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_name
    ON public.equipment (game_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.equipment_attributes (
    game_id varchar(64) NOT NULL,
    equipment_key varchar(64) NOT NULL,
    attribute_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_equipment_attributes PRIMARY KEY (game_id, equipment_key),
    CONSTRAINT fk_equipment_attributes_equipment
        FOREIGN KEY (game_id, equipment_key)
        REFERENCES public.equipment (game_id, equipment_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_equipment_attributes_values
        CHECK (jsonb_typeof(attribute_values) = 'object')
);

COMMENT ON TABLE public.equipment IS '装备';
COMMENT ON TABLE public.equipment_attributes IS '装备直接属性';

COMMIT;
