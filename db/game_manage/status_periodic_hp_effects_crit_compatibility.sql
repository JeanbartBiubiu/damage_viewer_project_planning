-- =============================================================================
-- Add typed crit columns for status_periodic_hp_effects and log tables
-- =============================================================================
--
-- Existing databases created before Batch J will not be altered by
-- CREATE TABLE IF NOT EXISTS in status_resource_schema.sql. This compatibility
-- migration adds the new typed crit columns needed by Admin read/write,
-- publish validation, and publish log snapshots.

ALTER TABLE public.status_periodic_hp_effects
    ADD COLUMN IF NOT EXISTS crit_chance_source varchar(32) NOT NULL DEFAULT 'none';

ALTER TABLE public.status_periodic_hp_effects
    ADD COLUMN IF NOT EXISTS crit_chance numeric(10, 6);

ALTER TABLE public.status_periodic_hp_effects
    ADD COLUMN IF NOT EXISTS crit_multiplier numeric(10, 6);

ALTER TABLE public.status_periodic_hp_effects_log
    ADD COLUMN IF NOT EXISTS crit_chance_source varchar(32) NOT NULL DEFAULT 'none';

ALTER TABLE public.status_periodic_hp_effects_log
    ADD COLUMN IF NOT EXISTS crit_chance numeric(10, 6);

ALTER TABLE public.status_periodic_hp_effects_log
    ADD COLUMN IF NOT EXISTS crit_multiplier numeric(10, 6);

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('status_periodic_hp_effects', 'status_periodic_hp_effects_log')
  AND column_name IN ('crit_chance_source', 'crit_chance', 'crit_multiplier')
ORDER BY table_name, column_name;
