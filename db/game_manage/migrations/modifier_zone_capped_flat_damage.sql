-- 防御前封顶平减：只增加 DAMAGE/FLAT_ADD/DAMAGE_PRE_DEFENSE 合法组合。
-- 目标及旧约束来自只读基线（SHA256 2456d4e648e760ec1765d454cd6d37f43a7e86b5f9c70f5d46cf84bdc8eeb9ed）。
-- 必须先独立复核并关闭业务写入窗口；本文件不创建目录或写入技能数据。
-- 任一旧约束/三张保护表漂移、重复执行或全业务行变化都会回滚。
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp, public;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '120s';

CREATE TEMP TABLE _cap_expected_after (domain varchar(16), calculation_mode varchar(24), application_stage varchar(32),
    CONSTRAINT _cap_after_combination CHECK (((((((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'FLAT_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_FLAT'::text)) OR (((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = ANY ((ARRAY['RATIO_ADD'::character varying, 'RATIO_MULTIPLY'::character varying, 'RATIO_COMPLEMENT_MULTIPLY'::character varying])::text[])) AND ((application_stage)::text = 'ATTRIBUTE_PERCENT'::text)) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = ANY ((ARRAY['DAMAGE_PRE_DEFENSE'::character varying, 'DAMAGE_POST_DEFENSE'::character varying])::text[]))) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_MULTIPLY'::text) AND ((application_stage)::text = 'DAMAGE_POST_DEFENSE'::text)) OR (((domain)::text = 'HEALING'::text) AND ((calculation_mode)::text = ANY ((ARRAY['RATIO_ADD'::character varying, 'RATIO_MAX'::character varying])::text[])) AND ((application_stage)::text = 'HEALING_RESULT'::text)) OR (((domain)::text = 'SHIELD'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'SHIELD_RESULT'::text))))) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'FLAT_ADD'::text) AND ((application_stage)::text = 'DAMAGE_PRE_DEFENSE'::text)))) ON COMMIT DROP;
CREATE TEMP TABLE _cap_before_rows (table_name text PRIMARY KEY, row_count bigint NOT NULL, row_sha256 text NOT NULL) ON COMMIT DROP;

DO $cap_migration$
DECLARE
    table_row record;
    observed_rows bigint;
    observed_hash text;
    after_definition text;
    actual_definition text;
    actual_constraints jsonb;
BEGIN
    IF current_database() <> 'test0221' OR current_setting('server_version_num')::integer <> 180000 THEN
        RAISE EXCEPTION 'database or PostgreSQL baseline differs';
    END IF;
    -- 一次性迁移在全部public业务表上阻止并发写入；不输出任何业务行。
    FOR table_row IN SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname LOOP
        EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', table_row.relname);
    END LOOP;
    SELECT jsonb_agg(jsonb_build_object('type',contype::text,'name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname)
      INTO actual_constraints FROM pg_catalog.pg_constraint WHERE conrelid='public.modifier_zones'::regclass;
    IF actual_constraints IS DISTINCT FROM $cap_baseline$[{"type":"c","name":"ck_modifier_zones_application_stage","definition":"CHECK (((application_stage)::text = ANY ((ARRAY['ATTRIBUTE_FLAT'::character varying, 'ATTRIBUTE_PERCENT'::character varying, 'DAMAGE_PRE_DEFENSE'::character varying, 'DAMAGE_POST_DEFENSE'::character varying, 'HEALING_RESULT'::character varying, 'SHIELD_RESULT'::character varying])::text[])))","validated":true},{"type":"c","name":"ck_modifier_zones_calculation_mode","definition":"CHECK (((calculation_mode)::text = ANY ((ARRAY['FLAT_ADD'::character varying, 'RATIO_ADD'::character varying, 'RATIO_MULTIPLY'::character varying, 'RATIO_COMPLEMENT_MULTIPLY'::character varying, 'RATIO_MAX'::character varying])::text[])))","validated":true},{"type":"c","name":"ck_modifier_zones_combination","definition":"CHECK (((((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'FLAT_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_FLAT'::text)) OR (((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = ANY ((ARRAY['RATIO_ADD'::character varying, 'RATIO_MULTIPLY'::character varying, 'RATIO_COMPLEMENT_MULTIPLY'::character varying])::text[])) AND ((application_stage)::text = 'ATTRIBUTE_PERCENT'::text)) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = ANY ((ARRAY['DAMAGE_PRE_DEFENSE'::character varying, 'DAMAGE_POST_DEFENSE'::character varying])::text[]))) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_MULTIPLY'::text) AND ((application_stage)::text = 'DAMAGE_POST_DEFENSE'::text)) OR (((domain)::text = 'HEALING'::text) AND ((calculation_mode)::text = ANY ((ARRAY['RATIO_ADD'::character varying, 'RATIO_MAX'::character varying])::text[])) AND ((application_stage)::text = 'HEALING_RESULT'::text)) OR (((domain)::text = 'SHIELD'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'SHIELD_RESULT'::text))))","validated":true},{"type":"c","name":"ck_modifier_zones_domain","definition":"CHECK (((domain)::text = ANY ((ARRAY['ATTRIBUTE'::character varying, 'DAMAGE'::character varying, 'HEALING'::character varying, 'SHIELD'::character varying])::text[])))","validated":true},{"type":"c","name":"ck_modifier_zones_key","definition":"CHECK (((modifier_zone_key)::text ~ '^[a-z][a-z0-9_]{0,63}$'::text))","validated":true},{"type":"c","name":"ck_modifier_zones_name","definition":"CHECK ((btrim((name)::text) <> ''::text))","validated":true},{"type":"c","name":"ck_modifier_zones_sort_order","definition":"CHECK ((sort_order >= 0))","validated":true},{"type":"c","name":"ck_modifier_zones_status","definition":"CHECK (((status)::text = ANY ((ARRAY['ENABLED'::character varying, 'DISABLED'::character varying])::text[])))","validated":true},{"type":"f","name":"fk_modifier_zones_game","definition":"FOREIGN KEY (game_id) REFERENCES games(game_id)","validated":true},{"type":"n","name":"modifier_zones_application_stage_not_null","definition":"NOT NULL application_stage","validated":true},{"type":"n","name":"modifier_zones_calculation_mode_not_null","definition":"NOT NULL calculation_mode","validated":true},{"type":"n","name":"modifier_zones_created_at_not_null","definition":"NOT NULL created_at","validated":true},{"type":"n","name":"modifier_zones_domain_not_null","definition":"NOT NULL domain","validated":true},{"type":"n","name":"modifier_zones_game_id_not_null","definition":"NOT NULL game_id","validated":true},{"type":"n","name":"modifier_zones_modifier_zone_key_not_null","definition":"NOT NULL modifier_zone_key","validated":true},{"type":"n","name":"modifier_zones_name_not_null","definition":"NOT NULL name","validated":true},{"type":"n","name":"modifier_zones_sort_order_not_null","definition":"NOT NULL sort_order","validated":true},{"type":"n","name":"modifier_zones_status_not_null","definition":"NOT NULL status","validated":true},{"type":"n","name":"modifier_zones_updated_at_not_null","definition":"NOT NULL updated_at","validated":true},{"type":"p","name":"pk_modifier_zones","definition":"PRIMARY KEY (game_id, modifier_zone_key)","validated":true}]$cap_baseline$::jsonb THEN
        RAISE EXCEPTION 'modifier_zones constraint baseline drift or replay';
    END IF;
    FOR table_row IN SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname LOOP
        EXECUTE format($row_digest$SELECT count(*), encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text || chr(10), '' ORDER BY to_jsonb(t)::text), ''), 'UTF8')), 'hex') FROM public.%I t$row_digest$,table_row.relname)
            INTO observed_rows, observed_hash;
        INSERT INTO _cap_before_rows VALUES(table_row.relname,observed_rows,observed_hash);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM _cap_before_rows WHERE table_name='modifier_zones' AND row_count=15 AND row_sha256='c473d7d56f450432381b8734059fee60426dfcecd8abd48316ec05d2ba571860') THEN RAISE EXCEPTION 'protected baseline changed: modifier_zones'; END IF;
    IF NOT EXISTS (SELECT 1 FROM _cap_before_rows WHERE table_name='skill_effects' AND row_count=1179 AND row_sha256='7a5d3cecab797a6fb5ef446f82519a9611c3a7b5464d3c28395dc09cbdeabcf4') THEN RAISE EXCEPTION 'protected baseline changed: skill_effects'; END IF;
    IF NOT EXISTS (SELECT 1 FROM _cap_before_rows WHERE table_name='skill_object_references' AND row_count=11381 AND row_sha256='a84ad4a407dd5e34f294177bf6350afc57fe22b6c684327702c2bdd8ceb68d42') THEN RAISE EXCEPTION 'protected baseline changed: skill_object_references'; END IF;

    ALTER TABLE public.modifier_zones DROP CONSTRAINT ck_modifier_zones_combination;
    ALTER TABLE public.modifier_zones ADD CONSTRAINT ck_modifier_zones_combination CHECK (((((((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'FLAT_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_FLAT'::text)) OR (((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = ANY ((ARRAY['RATIO_ADD'::character varying, 'RATIO_MULTIPLY'::character varying, 'RATIO_COMPLEMENT_MULTIPLY'::character varying])::text[])) AND ((application_stage)::text = 'ATTRIBUTE_PERCENT'::text)) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = ANY ((ARRAY['DAMAGE_PRE_DEFENSE'::character varying, 'DAMAGE_POST_DEFENSE'::character varying])::text[]))) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_MULTIPLY'::text) AND ((application_stage)::text = 'DAMAGE_POST_DEFENSE'::text)) OR (((domain)::text = 'HEALING'::text) AND ((calculation_mode)::text = ANY ((ARRAY['RATIO_ADD'::character varying, 'RATIO_MAX'::character varying])::text[])) AND ((application_stage)::text = 'HEALING_RESULT'::text)) OR (((domain)::text = 'SHIELD'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'SHIELD_RESULT'::text))))) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'FLAT_ADD'::text) AND ((application_stage)::text = 'DAMAGE_PRE_DEFENSE'::text)));

    SELECT pg_get_constraintdef(oid) INTO after_definition FROM pg_catalog.pg_constraint
        WHERE conrelid='_cap_expected_after'::regclass AND conname='_cap_after_combination';
    SELECT pg_get_constraintdef(oid) INTO actual_definition FROM pg_catalog.pg_constraint
        WHERE conrelid='public.modifier_zones'::regclass AND conname='ck_modifier_zones_combination' AND contype='c' AND convalidated;
    IF actual_definition IS DISTINCT FROM after_definition THEN RAISE EXCEPTION 'new combination verification failed'; END IF;
    FOR table_row IN SELECT * FROM _cap_before_rows ORDER BY table_name LOOP
        EXECUTE format($row_digest$SELECT count(*), encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text || chr(10), '' ORDER BY to_jsonb(t)::text), ''), 'UTF8')), 'hex') FROM public.%I t$row_digest$,table_row.table_name)
            INTO observed_rows, observed_hash;
        IF observed_rows <> table_row.row_count OR observed_hash <> table_row.row_sha256 THEN
            RAISE EXCEPTION 'business rows changed in %',table_row.table_name;
        END IF;
    END LOOP;
    RAISE NOTICE 'constraint changed once; all public business rows are byte-equivalent under sorted JSONB';
END;
$cap_migration$;
COMMIT;
