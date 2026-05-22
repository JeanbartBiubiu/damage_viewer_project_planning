-- =============================================================================
-- Expand publish-chain version_code columns to varchar(64)
-- =============================================================================
--
-- Batch H uses version code v2_batch_h_stacking_stat_passives_001 (37 chars).
-- CREATE TABLE IF NOT EXISTS does not alter existing varchar(32) databases, so
-- this compatibility migration makes the schema change reproducible for
-- already-created DBs.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'game_versions'
           AND column_name = 'version_code'
           AND character_maximum_length < 64
    ) THEN
        ALTER TABLE public.game_versions
            ALTER COLUMN version_code TYPE varchar(64);
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'published_bundle_snapshots'
           AND column_name = 'version_code'
           AND character_maximum_length < 64
    ) THEN
        ALTER TABLE public.published_bundle_snapshots
            ALTER COLUMN version_code TYPE varchar(64);
    END IF;
END $$;

SELECT
    table_name,
    column_name,
    character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('game_versions', 'published_bundle_snapshots')
  AND column_name = 'version_code'
ORDER BY table_name;
