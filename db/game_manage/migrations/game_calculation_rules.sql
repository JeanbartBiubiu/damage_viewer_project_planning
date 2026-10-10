-- 在核定的已有目标库单次执行；仅创建游戏计算配置表，不填默认配置或修改业务数据。
CREATE TABLE public.game_calculation_rules (
    game_id varchar(64) NOT NULL,
    configuration jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_game_calculation_rules PRIMARY KEY (game_id),
    CONSTRAINT fk_game_calculation_rules_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_game_calculation_rules_configuration CHECK (
        jsonb_typeof(configuration) = 'object'
        AND configuration ?& ARRAY['criticalChanceAttributeKey', 'criticalMultiplierMin', 'attackSpeedAttributeKey', 'attributeDerivations']
        AND jsonb_typeof(configuration->'criticalChanceAttributeKey') IN ('string', 'null')
        AND jsonb_typeof(configuration->'criticalMultiplierMin') IN ('number', 'null')
        AND jsonb_typeof(configuration->'attackSpeedAttributeKey') IN ('string', 'null')
        AND CASE WHEN jsonb_typeof(configuration->'attributeDerivations') = 'array'
            THEN jsonb_array_length(configuration->'attributeDerivations') <= 4 ELSE false END
    )
);

COMMENT ON TABLE public.game_calculation_rules IS '游戏暴击与连续速度用途绑定及完整共同属性派生；无默认业务配置';
COMMENT ON COLUMN public.game_calculation_rules.configuration IS '完整作者JSON；严格字段、启用目录、非生命输出与共同公式授权由游戏锁内的最终态校验维护，不写入技能引用索引';
