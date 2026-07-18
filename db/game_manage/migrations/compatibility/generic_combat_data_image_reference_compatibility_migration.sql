-- =============================================================================
-- Generic combat-data image URI reference compatibility
-- (game_entities / attribute_definitions + log tables)
-- =============================================================================
--
-- Idempotent upgrade for existing databases that already have the generic
-- combat-data model. Fresh installs should use schema.sql instead of this file.
--
-- Safe contract:
-- - ADD COLUMN IF NOT EXISTS only
-- - DO $$ / pg_constraint guards for named composite FKs
-- - no DELETE, DROP, CASCADE, data rewrite, or publish

ALTER TABLE public.game_entities
    ADD COLUMN IF NOT EXISTS image_uri varchar(255);

ALTER TABLE public.game_entities_log
    ADD COLUMN IF NOT EXISTS image_uri varchar(255);

ALTER TABLE public.attribute_definitions
    ADD COLUMN IF NOT EXISTS image_uri varchar(255);

ALTER TABLE public.attribute_definitions_log
    ADD COLUMN IF NOT EXISTS image_uri varchar(255);

DO $$
BEGIN
    IF to_regclass('public.game_entities') IS NOT NULL
       AND to_regclass('public.images') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'game_entities'
              AND c.conname = 'fk_game_entities_image'
       ) THEN
        ALTER TABLE public.game_entities
            ADD CONSTRAINT fk_game_entities_image
            FOREIGN KEY (game_id, image_uri)
            REFERENCES public.images (game_id, uri);
    END IF;

    IF to_regclass('public.game_entities_log') IS NOT NULL
       AND to_regclass('public.images') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'game_entities_log'
              AND c.conname = 'fk_game_entities_log_image'
       ) THEN
        ALTER TABLE public.game_entities_log
            ADD CONSTRAINT fk_game_entities_log_image
            FOREIGN KEY (game_id, image_uri)
            REFERENCES public.images (game_id, uri);
    END IF;

    IF to_regclass('public.attribute_definitions') IS NOT NULL
       AND to_regclass('public.images') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'attribute_definitions'
              AND c.conname = 'fk_attribute_definitions_image'
       ) THEN
        ALTER TABLE public.attribute_definitions
            ADD CONSTRAINT fk_attribute_definitions_image
            FOREIGN KEY (game_id, image_uri)
            REFERENCES public.images (game_id, uri);
    END IF;

    IF to_regclass('public.attribute_definitions_log') IS NOT NULL
       AND to_regclass('public.images') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'attribute_definitions_log'
              AND c.conname = 'fk_attribute_definitions_log_image'
       ) THEN
        ALTER TABLE public.attribute_definitions_log
            ADD CONSTRAINT fk_attribute_definitions_log_image
            FOREIGN KEY (game_id, image_uri)
            REFERENCES public.images (game_id, uri);
    END IF;
END $$;

COMMENT ON COLUMN public.game_entities.image_uri IS '可选同游戏 images.uri 引用；随 change_revision 版本化；图片字节本身不纳入版本';
COMMENT ON COLUMN public.game_entities_log.image_uri IS '可选同游戏 images.uri 引用快照；仅存 URI，不含图片字节';
COMMENT ON COLUMN public.attribute_definitions.image_uri IS '可选同游戏 images.uri 引用；随 change_revision 版本化；图片字节本身不纳入版本';
COMMENT ON COLUMN public.attribute_definitions_log.image_uri IS '可选同游戏 images.uri 引用快照；仅存 URI，不含图片字节';
