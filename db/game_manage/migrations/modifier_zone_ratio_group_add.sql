-- 同组增幅：只扩现有两条检查约束；不增加业务表、列、默认数据或新分组标识。
-- 离线准备脚本。执行前另行核对只读预检、目标库与写入授权，不批跑迁移目录。
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.modifier_zones IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE MODE;

DO $grouped_amplification$
DECLARE
    before_constraints jsonb;
    after_constraints jsonb;
    before_rows jsonb;
    after_rows jsonb;
    mode_expression text;
    combination_expression text;
    candidate record;
    observed_mode boolean;
    observed_combination boolean;
    expected_mode boolean;
    expected_combination boolean;
    phase integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='modifier_zones' AND column_name='calculation_mode'
          AND data_type='character varying' AND character_maximum_length=32 AND is_nullable='NO') THEN
        RAISE EXCEPTION 'modifier_zones calculation_mode baseline differs; stop before changing constraints';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid='public.modifier_zones'::regclass AND contype='c' AND convalidated
          AND conname IN ('ck_modifier_zones_calculation_mode','ck_modifier_zones_combination')) <> 2 THEN
        RAISE EXCEPTION 'both validated modifier zone checks are required';
    END IF;
    SELECT jsonb_object_agg(conname, jsonb_build_object('type',contype::text,'validated',convalidated,
        'definition',pg_get_constraintdef(oid))) INTO before_constraints
        FROM pg_catalog.pg_constraint WHERE conrelid='public.modifier_zones'::regclass;
    SELECT jsonb_build_object(
        'modifier_zones', (SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
            COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex')) FROM public.modifier_zones t),
        'skill_effects', (SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
            COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex')) FROM public.skill_effects t),
        'skill_object_references', (SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
            COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex')) FROM public.skill_object_references t)
    ) INTO before_rows;

    -- 同一有限枚举矩阵同时核对迁移前后；原五种方式的合法组合完整保留。
    FOR phase IN 0..1 LOOP
        IF phase = 1 THEN
            ALTER TABLE public.modifier_zones DROP CONSTRAINT ck_modifier_zones_calculation_mode;
            ALTER TABLE public.modifier_zones DROP CONSTRAINT ck_modifier_zones_combination;
            ALTER TABLE public.modifier_zones ADD CONSTRAINT ck_modifier_zones_calculation_mode
                CHECK (calculation_mode IN ('FLAT_ADD', 'RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY', 'RATIO_MAX', 'RATIO_GROUP_ADD'));
            ALTER TABLE public.modifier_zones ADD CONSTRAINT ck_modifier_zones_combination
                CHECK (
                    (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD'
                        AND application_stage = 'ATTRIBUTE_FLAT')
                    OR (domain = 'ATTRIBUTE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY', 'RATIO_GROUP_ADD')
                        AND application_stage = 'ATTRIBUTE_PERCENT')
                    OR (domain = 'DAMAGE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_GROUP_ADD')
                        AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
                    OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_MULTIPLY'
                        AND application_stage = 'DAMAGE_POST_DEFENSE')
                    OR (domain = 'DAMAGE' AND calculation_mode = 'FLAT_ADD'
                        AND application_stage = 'DAMAGE_PRE_DEFENSE')
                    OR (domain = 'HEALING' AND calculation_mode = 'RATIO_ADD'
                        AND application_stage = 'HEALING_RESULT')
                    OR (domain = 'HEALING' AND calculation_mode = 'RATIO_MAX'
                        AND application_stage = 'HEALING_RESULT')
                    OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD'
                        AND application_stage = 'SHIELD_RESULT')
                );
        END IF;
        SELECT pg_get_expr(conbin,conrelid) INTO mode_expression FROM pg_catalog.pg_constraint
            WHERE conrelid='public.modifier_zones'::regclass AND conname='ck_modifier_zones_calculation_mode';
        SELECT pg_get_expr(conbin,conrelid) INTO combination_expression FROM pg_catalog.pg_constraint
            WHERE conrelid='public.modifier_zones'::regclass AND conname='ck_modifier_zones_combination';
        FOR candidate IN SELECT d.domain,m.mode,s.stage FROM
            unnest(ARRAY['ATTRIBUTE','DAMAGE','HEALING','SHIELD','invalid_domain']) AS d(domain)
            CROSS JOIN unnest(ARRAY['FLAT_ADD','RATIO_ADD','RATIO_MULTIPLY','RATIO_COMPLEMENT_MULTIPLY','RATIO_MAX','RATIO_GROUP_ADD','invalid_mode']) AS m(mode)
            CROSS JOIN unnest(ARRAY['ATTRIBUTE_FLAT','ATTRIBUTE_PERCENT','DAMAGE_PRE_DEFENSE','DAMAGE_POST_DEFENSE','HEALING_RESULT','SHIELD_RESULT','invalid_stage']) AS s(stage)
        LOOP
            expected_mode := candidate.mode = ANY(ARRAY['FLAT_ADD','RATIO_ADD','RATIO_MULTIPLY','RATIO_COMPLEMENT_MULTIPLY','RATIO_MAX'])
                OR phase=1 AND candidate.mode='RATIO_GROUP_ADD';
            expected_combination :=
                candidate.domain='ATTRIBUTE' AND candidate.mode='FLAT_ADD' AND candidate.stage='ATTRIBUTE_FLAT'
                OR candidate.domain='ATTRIBUTE' AND candidate.mode=ANY(ARRAY['RATIO_ADD','RATIO_MULTIPLY','RATIO_COMPLEMENT_MULTIPLY']) AND candidate.stage='ATTRIBUTE_PERCENT'
                OR candidate.domain='DAMAGE' AND candidate.mode='RATIO_ADD' AND candidate.stage=ANY(ARRAY['DAMAGE_PRE_DEFENSE','DAMAGE_POST_DEFENSE'])
                OR candidate.domain='DAMAGE' AND candidate.mode='RATIO_MULTIPLY' AND candidate.stage='DAMAGE_POST_DEFENSE'
                OR candidate.domain='DAMAGE' AND candidate.mode='FLAT_ADD' AND candidate.stage='DAMAGE_PRE_DEFENSE'
                OR candidate.domain='HEALING' AND candidate.mode=ANY(ARRAY['RATIO_ADD','RATIO_MAX']) AND candidate.stage='HEALING_RESULT'
                OR candidate.domain='SHIELD' AND candidate.mode='RATIO_ADD' AND candidate.stage='SHIELD_RESULT'
                OR phase=1 AND candidate.mode='RATIO_GROUP_ADD' AND
                    (candidate.domain='ATTRIBUTE' AND candidate.stage='ATTRIBUTE_PERCENT'
                     OR candidate.domain='DAMAGE' AND candidate.stage=ANY(ARRAY['DAMAGE_PRE_DEFENSE','DAMAGE_POST_DEFENSE']));
            EXECUTE format('SELECT (%s) IS TRUE,(%s) IS TRUE FROM (SELECT $1::varchar(16) AS domain,$2::varchar(32) AS calculation_mode,$3::varchar(32) AS application_stage) AS modifier_zones',
                mode_expression,combination_expression) INTO observed_mode,observed_combination
                USING candidate.domain,candidate.mode,candidate.stage;
            IF observed_mode IS DISTINCT FROM expected_mode OR observed_combination IS DISTINCT FROM expected_combination THEN
                RAISE EXCEPTION 'modifier zone matrix drift/replay at phase %, %/%/%',phase,candidate.domain,candidate.mode,candidate.stage;
            END IF;
        END LOOP;
    END LOOP;
    SELECT jsonb_object_agg(conname,jsonb_build_object('type',contype::text,'validated',convalidated,
        'definition',pg_get_constraintdef(oid))) INTO after_constraints
        FROM pg_catalog.pg_constraint WHERE conrelid='public.modifier_zones'::regclass;
    IF (before_constraints - 'ck_modifier_zones_calculation_mode' - 'ck_modifier_zones_combination')
        IS DISTINCT FROM (after_constraints - 'ck_modifier_zones_calculation_mode' - 'ck_modifier_zones_combination') THEN
        RAISE EXCEPTION 'unrelated modifier zone constraints changed';
    END IF;
    SELECT jsonb_build_object(
        'modifier_zones', (SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
            COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex')) FROM public.modifier_zones t),
        'skill_effects', (SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
            COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex')) FROM public.skill_effects t),
        'skill_object_references', (SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
            COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex')) FROM public.skill_object_references t)
    ) INTO after_rows;
    IF before_rows IS DISTINCT FROM after_rows THEN RAISE EXCEPTION 'protected business rows changed'; END IF;
END;
$grouped_amplification$;
COMMIT;
