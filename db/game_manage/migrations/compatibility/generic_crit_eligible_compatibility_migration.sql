-- =============================================================================
-- Generic crit_eligible compatibility (damage_effect_details + log)
-- =============================================================================
--
-- Idempotent upgrade for existing databases that already have the generic
-- combat-data model. Fresh installs should use schema.sql instead of this file.
--
-- Safe contract:
-- - ADD COLUMN IF NOT EXISTS only
-- - no DELETE, DROP, CASCADE, data rewrite, or publish
-- - existing rows receive DEFAULT false

ALTER TABLE public.damage_effect_details
    ADD COLUMN IF NOT EXISTS crit_eligible boolean NOT NULL DEFAULT false;

ALTER TABLE public.damage_effect_details_log
    ADD COLUMN IF NOT EXISTS crit_eligible boolean NOT NULL DEFAULT false;
