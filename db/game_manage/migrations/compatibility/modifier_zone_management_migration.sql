-- 乘区管理迁移。
-- 本迁移不创建默认乘区，也不根据旧结果推断乘区。
-- 执行成功后必须继续执行 db/game_manage/triggers.sql，刷新聚合约束函数。

BEGIN;

DO $$
DECLARE
    v_attribute_count bigint;
    v_damage_count bigint;
    v_healing_count bigint;
    v_ezreal_passive_count bigint;
BEGIN
    IF to_regclass('public.modifier_zones') IS NOT NULL THEN
        RAISE EXCEPTION 'public.modifier_zones already exists; refuse to guess whether this migration was partially applied';
    END IF;

    SELECT COUNT(*) INTO v_attribute_count
      FROM public.skill_effect_attribute_change_details d
      JOIN public.skill_effect_result_lifecycle_behaviors b
        ON b.game_id = d.game_id
       AND b.skill_key = d.skill_key
       AND b.effect_key = d.effect_key
       AND b.result_key = d.result_key
     WHERE b.moment = 'PERSISTENT'
       AND d.operation IN ('INCREASE', 'DECREASE');
    SELECT COUNT(*) INTO v_damage_count
      FROM public.skill_effect_damage_modifier_details;
    SELECT COUNT(*) INTO v_healing_count
      FROM public.skill_effect_healing_modifier_details;

    SELECT COUNT(*) INTO v_ezreal_passive_count
      FROM public.skill_effect_attribute_change_details d
      JOIN public.skill_effect_result_lifecycle_behaviors b
        ON b.game_id = d.game_id
       AND b.skill_key = d.skill_key
       AND b.effect_key = d.effect_key
       AND b.result_key = d.result_key
     WHERE b.moment = 'PERSISTENT'
       AND d.game_id = 'lol'
       AND d.skill_key = 'ez_p'
       AND d.effect_key = 'rising_spell_force'
       AND d.result_key = 'attack_speed_gain'
       AND d.attribute_key = 'bonus_attack_speed_percent'
       AND d.operation = 'INCREASE';

    IF v_damage_count <> 0
        OR v_healing_count <> 0
        OR v_attribute_count <> v_ezreal_passive_count THEN
        RAISE EXCEPTION
            'modifier zone migration requires owner mapping or deletion first: attribute=%, approved_ezreal_passive=%, damage=%, healing=%',
            v_attribute_count, v_ezreal_passive_count, v_damage_count, v_healing_count;
    END IF;
END;
$$;

CREATE TABLE public.modifier_zones (
    game_id varchar(64) NOT NULL,
    modifier_zone_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    domain varchar(16) NOT NULL,
    calculation_mode varchar(16) NOT NULL,
    application_stage varchar(32) NOT NULL,
    description text,
    status varchar(16) NOT NULL DEFAULT 'ENABLED',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_modifier_zones PRIMARY KEY (game_id, modifier_zone_key),
    CONSTRAINT fk_modifier_zones_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_modifier_zones_key
        CHECK (modifier_zone_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_modifier_zones_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_modifier_zones_domain
        CHECK (domain IN ('ATTRIBUTE', 'DAMAGE', 'HEALING')),
    CONSTRAINT ck_modifier_zones_calculation_mode
        CHECK (calculation_mode IN ('FLAT_ADD', 'RATIO_ADD')),
    CONSTRAINT ck_modifier_zones_application_stage
        CHECK (application_stage IN (
            'ATTRIBUTE_FLAT', 'ATTRIBUTE_PERCENT',
            'DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE', 'HEALING_RESULT'
        )),
    CONSTRAINT ck_modifier_zones_combination
        CHECK (
            (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD'
                AND application_stage = 'ATTRIBUTE_FLAT')
            OR (domain = 'ATTRIBUTE' AND calculation_mode = 'RATIO_ADD'
                AND application_stage = 'ATTRIBUTE_PERCENT')
            OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD'
                AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
            OR (domain = 'HEALING' AND calculation_mode = 'RATIO_ADD'
                AND application_stage = 'HEALING_RESULT')
        ),
    CONSTRAINT ck_modifier_zones_status CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_modifier_zones_sort_order CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_modifier_zones_name
    ON public.modifier_zones (game_id, lower(btrim(name)));

COMMENT ON TABLE public.modifier_zones IS '属性、伤害与治疗修正乘区';

ALTER TABLE public.skill_effect_attribute_change_details
    ADD COLUMN modifier_zone_key varchar(64),
    ADD CONSTRAINT fk_skill_effect_attribute_change_details_zone
        FOREIGN KEY (game_id, modifier_zone_key)
        REFERENCES public.modifier_zones (game_id, modifier_zone_key)
        ON DELETE RESTRICT;

CREATE INDEX ix_skill_effect_attribute_change_details_zone
    ON public.skill_effect_attribute_change_details
    (game_id, modifier_zone_key, skill_key, effect_key, result_key)
    WHERE modifier_zone_key IS NOT NULL;

-- 2026-08-31 负责人确认：伊泽瑞尔被动攻速加成归入属性百分比加成乘区。
INSERT INTO public.modifier_zones (
    game_id, modifier_zone_key, name, domain, calculation_mode,
    application_stage, description, status, sort_order
)
SELECT
    'lol', 'attribute_percent_bonus', '属性百分比加成', 'ATTRIBUTE', 'RATIO_ADD',
    'ATTRIBUTE_PERCENT', NULL, 'ENABLED', 0
WHERE EXISTS (
    SELECT 1
      FROM public.skill_effect_attribute_change_details d
     WHERE d.game_id = 'lol'
       AND d.skill_key = 'ez_p'
       AND d.effect_key = 'rising_spell_force'
       AND d.result_key = 'attack_speed_gain'
       AND d.attribute_key = 'bonus_attack_speed_percent'
       AND d.operation = 'INCREASE'
);

UPDATE public.skill_effect_attribute_change_details
   SET modifier_zone_key = 'attribute_percent_bonus'
 WHERE game_id = 'lol'
   AND skill_key = 'ez_p'
   AND effect_key = 'rising_spell_force'
   AND result_key = 'attack_speed_gain'
   AND attribute_key = 'bonus_attack_speed_percent'
   AND operation = 'INCREASE';

ALTER TABLE public.skill_effect_damage_modifier_details
    ADD COLUMN modifier_zone_key varchar(64) NOT NULL,
    ADD CONSTRAINT fk_skill_effect_damage_modifier_zone
        FOREIGN KEY (game_id, modifier_zone_key)
        REFERENCES public.modifier_zones (game_id, modifier_zone_key)
        ON DELETE RESTRICT;

CREATE INDEX ix_skill_effect_damage_modifier_zone
    ON public.skill_effect_damage_modifier_details
    (game_id, modifier_zone_key, skill_key, effect_key, result_key);

ALTER TABLE public.skill_effect_healing_modifier_details
    ADD COLUMN modifier_zone_key varchar(64) NOT NULL,
    ADD CONSTRAINT fk_skill_effect_healing_modifier_zone
        FOREIGN KEY (game_id, modifier_zone_key)
        REFERENCES public.modifier_zones (game_id, modifier_zone_key)
        ON DELETE RESTRICT;

CREATE INDEX ix_skill_effect_healing_modifier_zone
    ON public.skill_effect_healing_modifier_details
    (game_id, modifier_zone_key, skill_key, effect_key, result_key);

COMMIT;
