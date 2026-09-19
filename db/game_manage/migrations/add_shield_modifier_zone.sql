-- 仅用于已核定的192.168.5.6:5432/test0221；只扩充乘区三项检查约束，不创建业务对象。
-- 执行方核对批准摘要和目标；该迁移拒绝重复执行，不修改历史迁移。
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.modifier_zones IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
    IF current_database() <> 'test0221' THEN RAISE EXCEPTION '收到护盾乘区迁移目标库不符'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.modifier_zones'::regclass
        AND conname='ck_modifier_zones_application_stage' AND convalidated AND pg_get_constraintdef(oid)=$old$CHECK (((application_stage)::text = ANY ((ARRAY['ATTRIBUTE_FLAT'::character varying, 'ATTRIBUTE_PERCENT'::character varying, 'DAMAGE_PRE_DEFENSE'::character varying, 'DAMAGE_POST_DEFENSE'::character varying, 'HEALING_RESULT'::character varying])::text[])))$old$) THEN
        RAISE EXCEPTION '收到护盾乘区迁移约束漂移或已执行：ck_modifier_zones_application_stage';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.modifier_zones'::regclass
        AND conname='ck_modifier_zones_combination' AND convalidated AND pg_get_constraintdef(oid)=$old$CHECK (((((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'FLAT_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_FLAT'::text)) OR (((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_PERCENT'::text)) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = ANY ((ARRAY['DAMAGE_PRE_DEFENSE'::character varying, 'DAMAGE_POST_DEFENSE'::character varying])::text[]))) OR (((domain)::text = 'HEALING'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'HEALING_RESULT'::text))))$old$) THEN
        RAISE EXCEPTION '收到护盾乘区迁移约束漂移或已执行：ck_modifier_zones_combination';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.modifier_zones'::regclass
        AND conname='ck_modifier_zones_domain' AND convalidated AND pg_get_constraintdef(oid)=$old$CHECK (((domain)::text = ANY ((ARRAY['ATTRIBUTE'::character varying, 'DAMAGE'::character varying, 'HEALING'::character varying])::text[])))$old$) THEN
        RAISE EXCEPTION '收到护盾乘区迁移约束漂移或已执行：ck_modifier_zones_domain';
    END IF;
    IF (SELECT count(*) FROM public.modifier_zones) <> 7 OR
        (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.modifier_zones t) <> '556764665c1e20099852024887940f26' THEN
        RAISE EXCEPTION '收到护盾乘区迁移原数据漂移：modifier_zones';
    END IF;
    IF (SELECT count(*) FROM public.skill_effects) <> 967 OR
        (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.skill_effects t) <> '9c979edcddad30aeb52662d3320085a3' THEN
        RAISE EXCEPTION '收到护盾乘区迁移原数据漂移：skill_effects';
    END IF;
    IF (SELECT count(*) FROM public.skill_object_references) <> 9315 OR
        (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.skill_object_references t) <> '3d0873fab9ba0e2dbf1ad8859f61ef3a' THEN
        RAISE EXCEPTION '收到护盾乘区迁移原数据漂移：skill_object_references';
    END IF;
END
$preflight$;
CREATE TEMP TABLE shield_before_modifier_zones ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.modifier_zones t;
CREATE TEMP TABLE shield_before_skill_effects ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.skill_effects t;
CREATE TEMP TABLE shield_before_skill_object_references ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.skill_object_references t;
ALTER TABLE public.modifier_zones
    DROP CONSTRAINT ck_modifier_zones_domain,
    DROP CONSTRAINT ck_modifier_zones_application_stage,
    DROP CONSTRAINT ck_modifier_zones_combination,
    ADD CONSTRAINT ck_modifier_zones_domain CHECK (domain IN ('ATTRIBUTE','DAMAGE','HEALING','SHIELD')),
    ADD CONSTRAINT ck_modifier_zones_application_stage CHECK (application_stage IN
        ('ATTRIBUTE_FLAT','ATTRIBUTE_PERCENT','DAMAGE_PRE_DEFENSE','DAMAGE_POST_DEFENSE','HEALING_RESULT','SHIELD_RESULT')),
    ADD CONSTRAINT ck_modifier_zones_combination CHECK (
        (domain='ATTRIBUTE' AND calculation_mode='FLAT_ADD' AND application_stage='ATTRIBUTE_FLAT')
        OR (domain='ATTRIBUTE' AND calculation_mode='RATIO_ADD' AND application_stage='ATTRIBUTE_PERCENT')
        OR (domain='DAMAGE' AND calculation_mode='RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE','DAMAGE_POST_DEFENSE'))
        OR (domain='HEALING' AND calculation_mode='RATIO_ADD' AND application_stage='HEALING_RESULT')
        OR (domain='SHIELD' AND calculation_mode='RATIO_ADD' AND application_stage='SHIELD_RESULT'));
COMMENT ON TABLE public.modifier_zones IS '属性、伤害、治疗与收到护盾修正乘区';
DO $verify$
BEGIN
    IF EXISTS ((SELECT body FROM shield_before_modifier_zones EXCEPT ALL SELECT to_jsonb(t) FROM public.modifier_zones t)
        UNION ALL (SELECT to_jsonb(t) FROM public.modifier_zones t EXCEPT ALL SELECT body FROM shield_before_modifier_zones)) THEN
        RAISE EXCEPTION '迁移改变原业务内容或时间戳：modifier_zones';
    END IF;
    IF EXISTS ((SELECT body FROM shield_before_skill_effects EXCEPT ALL SELECT to_jsonb(t) FROM public.skill_effects t)
        UNION ALL (SELECT to_jsonb(t) FROM public.skill_effects t EXCEPT ALL SELECT body FROM shield_before_skill_effects)) THEN
        RAISE EXCEPTION '迁移改变原业务内容或时间戳：skill_effects';
    END IF;
    IF EXISTS ((SELECT body FROM shield_before_skill_object_references EXCEPT ALL SELECT to_jsonb(t) FROM public.skill_object_references t)
        UNION ALL (SELECT to_jsonb(t) FROM public.skill_object_references t EXCEPT ALL SELECT body FROM shield_before_skill_object_references)) THEN
        RAISE EXCEPTION '迁移改变原业务内容或时间戳：skill_object_references';
    END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.modifier_zones'::regclass
        AND conname IN ('ck_modifier_zones_domain','ck_modifier_zones_application_stage','ck_modifier_zones_combination')
        AND convalidated AND pg_get_constraintdef(oid) LIKE '%SHIELD%') <> 3 THEN
        RAISE EXCEPTION '收到护盾乘区约束验证失败';
    END IF;
END
$verify$;
COMMIT;
