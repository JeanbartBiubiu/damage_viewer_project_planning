-- 现有计算配置只补缺失的用途字段；已有绑定、公式与更新时间保持原值。
BEGIN;

LOCK TABLE public.game_calculation_rules IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.game_calculation_rules
SET configuration = jsonb_build_object(
    'basicAttackCategoryKey', null,
    'equipmentPassiveCategoryKey', null,
    'ignorableCastCostAttributeKeys', '[]'::jsonb
) || configuration
WHERE NOT configuration ?& ARRAY['basicAttackCategoryKey', 'equipmentPassiveCategoryKey', 'ignorableCastCostAttributeKeys'];

ALTER TABLE public.game_calculation_rules
    DROP CONSTRAINT ck_game_calculation_rules_configuration,
    ADD CONSTRAINT ck_game_calculation_rules_configuration CHECK (
        jsonb_typeof(configuration) = 'object'
        AND configuration ?& ARRAY['criticalChanceAttributeKey', 'criticalMultiplierMin', 'attackSpeedAttributeKey', 'attributeDerivations',
            'basicAttackCategoryKey', 'equipmentPassiveCategoryKey', 'ignorableCastCostAttributeKeys']
        AND jsonb_typeof(configuration->'criticalChanceAttributeKey') IN ('string', 'null')
        AND jsonb_typeof(configuration->'criticalMultiplierMin') IN ('number', 'null')
        AND jsonb_typeof(configuration->'attackSpeedAttributeKey') IN ('string', 'null')
        AND jsonb_typeof(configuration->'basicAttackCategoryKey') IN ('string', 'null')
        AND jsonb_typeof(configuration->'equipmentPassiveCategoryKey') IN ('string', 'null')
        AND CASE WHEN jsonb_typeof(configuration->'ignorableCastCostAttributeKeys') = 'array'
            THEN jsonb_array_length(configuration->'ignorableCastCostAttributeKeys') <= 32 ELSE false END
        AND CASE WHEN jsonb_typeof(configuration->'attributeDerivations') = 'array'
            THEN jsonb_array_length(configuration->'attributeDerivations') <= 4 ELSE false END
    );

COMMENT ON TABLE public.game_calculation_rules IS '游戏属性与技能分类用途绑定、可明确忽略的施法成本属性及完整共同属性派生；无默认业务配置';

COMMIT;
