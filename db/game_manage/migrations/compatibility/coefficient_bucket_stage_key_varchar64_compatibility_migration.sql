-- =============================================================================
-- Expand coefficient bucket stage_key columns to varchar(64)
-- =============================================================================
--
-- CREATE TABLE IF NOT EXISTS does not alter existing varchar(32) databases, so
-- this compatibility migration makes the schema change reproducible for
-- already-created DBs.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'coefficient_buckets'
           AND column_name = 'stage_key'
           AND character_maximum_length < 64
    ) THEN
        ALTER TABLE public.coefficient_buckets
            ALTER COLUMN stage_key TYPE varchar(64);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'coefficient_buckets_log'
           AND column_name = 'stage_key'
           AND character_maximum_length < 64
    ) THEN
        ALTER TABLE public.coefficient_buckets_log
            ALTER COLUMN stage_key TYPE varchar(64);
    END IF;
END $$;

SELECT
    table_name,
    column_name,
    character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('coefficient_buckets', 'coefficient_buckets_log')
  AND column_name = 'stage_key'
ORDER BY table_name;
