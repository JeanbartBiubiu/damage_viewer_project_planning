-- =============================================================================
-- Add optional numeric bounds columns for attribute_definitions and log tables
-- =============================================================================
--
-- Existing databases created before Batch T will not pick up new columns from
-- CREATE TABLE IF NOT EXISTS in schema.sql. This compatibility migration adds
-- min_value / max_value and ordering check constraints for Admin read/write,
-- publish validation, and publish log snapshots.

ALTER TABLE public.attribute_definitions
    ADD COLUMN IF NOT EXISTS min_value numeric;

ALTER TABLE public.attribute_definitions
    ADD COLUMN IF NOT EXISTS max_value numeric;

ALTER TABLE public.attribute_definitions_log
    ADD COLUMN IF NOT EXISTS min_value numeric;

ALTER TABLE public.attribute_definitions_log
    ADD COLUMN IF NOT EXISTS max_value numeric;

ALTER TABLE public.attribute_definitions
    DROP CONSTRAINT IF EXISTS ck_attribute_definitions_bounds;

ALTER TABLE public.attribute_definitions
    ADD CONSTRAINT ck_attribute_definitions_bounds
    CHECK (
        min_value IS NULL
        OR max_value IS NULL
        OR min_value <= max_value
    );

ALTER TABLE public.attribute_definitions_log
    DROP CONSTRAINT IF EXISTS ck_attribute_definitions_log_bounds;

ALTER TABLE public.attribute_definitions_log
    ADD CONSTRAINT ck_attribute_definitions_log_bounds
    CHECK (
        min_value IS NULL
        OR max_value IS NULL
        OR min_value <= max_value
    );

COMMENT ON COLUMN public.attribute_definitions.min_value IS '可选数值下界；与 default_value / max_value 一起在应用层校验';
COMMENT ON COLUMN public.attribute_definitions.max_value IS '可选数值上界；与 default_value / min_value 一起在应用层校验';
COMMENT ON COLUMN public.attribute_definitions_log.min_value IS '可选数值下界快照';
COMMENT ON COLUMN public.attribute_definitions_log.max_value IS '可选数值上界快照';

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('attribute_definitions', 'attribute_definitions_log')
  AND column_name IN ('min_value', 'max_value')
ORDER BY table_name, column_name;
