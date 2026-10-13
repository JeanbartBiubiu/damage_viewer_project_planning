BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.modifier_zones DROP CONSTRAINT ck_modifier_zones_calculation_mode;
ALTER TABLE public.modifier_zones ADD CONSTRAINT ck_modifier_zones_calculation_mode
    CHECK (calculation_mode IN ('FLAT_ADD', 'RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_MAX'));
ALTER TABLE public.modifier_zones DROP CONSTRAINT ck_modifier_zones_combination;
ALTER TABLE public.modifier_zones ADD CONSTRAINT ck_modifier_zones_combination
    CHECK (
        (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD' AND application_stage = 'ATTRIBUTE_FLAT')
        OR (domain = 'ATTRIBUTE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MULTIPLY') AND application_stage = 'ATTRIBUTE_PERCENT')
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
        OR (domain = 'HEALING' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MAX') AND application_stage = 'HEALING_RESULT')
        OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'SHIELD_RESULT')
    );
COMMIT;
