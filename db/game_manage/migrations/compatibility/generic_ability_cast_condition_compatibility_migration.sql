-- =============================================================================
-- Generic ability castCondition compatibility (ability_definitions + log)
-- =============================================================================
--
-- Idempotent upgrade for existing databases that already have the generic
-- combat-data model. Fresh installs should use schema.sql instead of this file.
--
-- Safe contract:
-- - ADD COLUMN IF NOT EXISTS only
-- - no DELETE, DROP, CASCADE, data rewrite, or publish
-- - existing rows remain NULL for cast_condition_formula_key

ALTER TABLE public.ability_definitions
    ADD COLUMN IF NOT EXISTS cast_condition_formula_key varchar(128);

ALTER TABLE public.ability_definitions_log
    ADD COLUMN IF NOT EXISTS cast_condition_formula_key varchar(128);
