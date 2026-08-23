-- Breaking cleanup for the retired combat resource model.
-- Run manually only after the exact database target, row counts, and backup are confirmed.

DROP TABLE IF EXISTS public.resource_effect_details_log;
DROP TABLE IF EXISTS public.resource_effect_details;
DROP TABLE IF EXISTS public.ability_costs_log;
DROP TABLE IF EXISTS public.ability_costs;
DROP TABLE IF EXISTS public.entity_resource_stage_values_log;
DROP TABLE IF EXISTS public.entity_resource_stage_values;
DROP TABLE IF EXISTS public.entity_resource_values_log;
DROP TABLE IF EXISTS public.entity_resource_values;
DROP TABLE IF EXISTS public.resource_definitions_log;
DROP TABLE IF EXISTS public.resource_definitions;
