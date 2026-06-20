-- =============================================================================
-- Expand long semantic game data ID / skill key columns to varchar(256)
-- =============================================================================
--
-- LoL item/skill imports can emit skill_id / skill_key values longer than the
-- original varchar(64) / varchar(16) limits. CREATE TABLE IF NOT EXISTS does not
-- alter existing databases, so this compatibility migration makes the schema
-- change reproducible for already-created DBs.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skills'
           AND column_name = 'skill_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skills
            ALTER COLUMN skill_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skills'
           AND column_name = 'owner_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skills
            ALTER COLUMN owner_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skills'
           AND column_name = 'skill_key'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skills
            ALTER COLUMN skill_key TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skills_log'
           AND column_name = 'skill_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skills_log
            ALTER COLUMN skill_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skills_log'
           AND column_name = 'owner_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skills_log
            ALTER COLUMN owner_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skills_log'
           AND column_name = 'skill_key'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skills_log
            ALTER COLUMN skill_key TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'items'
           AND column_name = 'item_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.items
            ALTER COLUMN item_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'items_log'
           AND column_name = 'item_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.items_log
            ALTER COLUMN item_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'item_stat_modifiers'
           AND column_name = 'item_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.item_stat_modifiers
            ALTER COLUMN item_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'item_stat_modifiers_log'
           AND column_name = 'item_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.item_stat_modifiers_log
            ALTER COLUMN item_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skill_mounts'
           AND column_name = 'target_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skill_mounts
            ALTER COLUMN target_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skill_mounts'
           AND column_name = 'skill_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skill_mounts
            ALTER COLUMN skill_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skill_mounts_log'
           AND column_name = 'target_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skill_mounts_log
            ALTER COLUMN target_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skill_mounts_log'
           AND column_name = 'skill_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.skill_mounts_log
            ALTER COLUMN skill_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'type_relations'
           AND column_name = 'target_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.type_relations
            ALTER COLUMN target_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'type_relations_log'
           AND column_name = 'target_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.type_relations_log
            ALTER COLUMN target_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'formula_bindings'
           AND column_name = 'target_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.formula_bindings
            ALTER COLUMN target_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'formula_bindings'
           AND column_name = 'binding_key'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.formula_bindings
            ALTER COLUMN binding_key TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'formula_bindings_log'
           AND column_name = 'target_id'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.formula_bindings_log
            ALTER COLUMN target_id TYPE varchar(256);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'formula_bindings_log'
           AND column_name = 'binding_key'
           AND character_maximum_length < 256
    ) THEN
        ALTER TABLE public.formula_bindings_log
            ALTER COLUMN binding_key TYPE varchar(256);
    END IF;
END $$;

SELECT
    table_name,
    column_name,
    character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'skills' AND column_name IN ('skill_id', 'owner_id', 'skill_key'))
      OR (table_name = 'skills_log' AND column_name IN ('skill_id', 'owner_id', 'skill_key'))
      OR (table_name = 'items' AND column_name = 'item_id')
      OR (table_name = 'items_log' AND column_name = 'item_id')
      OR (table_name = 'item_stat_modifiers' AND column_name = 'item_id')
      OR (table_name = 'item_stat_modifiers_log' AND column_name = 'item_id')
      OR (table_name = 'skill_mounts' AND column_name IN ('target_id', 'skill_id'))
      OR (table_name = 'skill_mounts_log' AND column_name IN ('target_id', 'skill_id'))
      OR (table_name = 'type_relations' AND column_name = 'target_id')
      OR (table_name = 'type_relations_log' AND column_name = 'target_id')
      OR (table_name = 'formula_bindings' AND column_name IN ('target_id', 'binding_key'))
      OR (table_name = 'formula_bindings_log' AND column_name IN ('target_id', 'binding_key'))
  )
ORDER BY table_name, column_name;
