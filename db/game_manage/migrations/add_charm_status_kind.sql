-- 已核定 test0221 原库的魅惑身份增量；执行方先校验连接主机与此文件摘要。
-- 仅变更种类约束及注释，不新增状态行；旧迁移与旧执行工具保持冻结。
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.statuses IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
 IF current_database() <> 'test0221' THEN RAISE EXCEPTION '目标数据库不符，停止魅惑身份迁移'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='statuses' AND column_name='status_kind' AND data_type='character varying' AND character_maximum_length=32 AND is_nullable='NO' AND column_default IS NULL) THEN RAISE EXCEPTION '状态种类列定义漂移'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND conname='ck_statuses_kind' AND contype='c' AND convalidated AND pg_get_constraintdef(oid)=$old$CHECK (((status_kind)::text = ANY ((ARRAY['STUN'::character varying, 'MOVEMENT_SLOW'::character varying, 'ROOT'::character varying, 'SILENCE'::character varying])::text[])))$old$) THEN RAISE EXCEPTION '旧状态种类约束漂移或已执行，禁止重放'; END IF;
 IF (SELECT count(*) FROM public.statuses) <> 4 OR EXISTS (
  (SELECT game_id,status_key,name,description,status_kind,status,sort_order,created_at,updated_at FROM public.statuses EXCEPT ALL SELECT * FROM jsonb_to_recordset('[{"name":"普通移动减速","status":"ENABLED","game_id":"lol","created_at":"2026-09-19T14:37:05.092208+08:00","sort_order":10,"status_key":"movement_slow","updated_at":"2026-09-19T16:22:48.378088+08:00","description":"普通移动减速状态身份；具体减速比例与持续时间由技能效果维护。","status_kind":"MOVEMENT_SLOW"},{"name":"禁锢","status":"ENABLED","game_id":"lol","created_at":"2026-09-19T12:52:01.232803+08:00","sort_order":20,"status_key":"root","updated_at":"2026-09-19T12:52:01.232803+08:00","description":"禁锢状态身份；具体持续时间由技能效果生命周期维护，本状态不另设强度数值。","status_kind":"ROOT"},{"name":"沉默","status":"ENABLED","game_id":"lol","created_at":"2026-09-20T00:42:34.531835+08:00","sort_order":30,"status_key":"silence","updated_at":"2026-09-20T00:42:34.531835+08:00","description":"沉默状态身份；具体持续时间由技能效果生命周期维护，本状态不另设强度数值。","status_kind":"SILENCE"},{"name":"眩晕","status":"ENABLED","game_id":"lol","created_at":"2026-08-28T22:55:06.53067+08:00","sort_order":0,"status_key":"vertigo","updated_at":"2026-08-28T22:55:06.53067+08:00","description":null,"status_kind":"STUN"}]'::jsonb) AS e(game_id text,status_key text,name text,description text,status_kind text,status text,sort_order integer,created_at timestamptz,updated_at timestamptz))
  UNION ALL
  (SELECT * FROM jsonb_to_recordset('[{"name":"普通移动减速","status":"ENABLED","game_id":"lol","created_at":"2026-09-19T14:37:05.092208+08:00","sort_order":10,"status_key":"movement_slow","updated_at":"2026-09-19T16:22:48.378088+08:00","description":"普通移动减速状态身份；具体减速比例与持续时间由技能效果维护。","status_kind":"MOVEMENT_SLOW"},{"name":"禁锢","status":"ENABLED","game_id":"lol","created_at":"2026-09-19T12:52:01.232803+08:00","sort_order":20,"status_key":"root","updated_at":"2026-09-19T12:52:01.232803+08:00","description":"禁锢状态身份；具体持续时间由技能效果生命周期维护，本状态不另设强度数值。","status_kind":"ROOT"},{"name":"沉默","status":"ENABLED","game_id":"lol","created_at":"2026-09-20T00:42:34.531835+08:00","sort_order":30,"status_key":"silence","updated_at":"2026-09-20T00:42:34.531835+08:00","description":"沉默状态身份；具体持续时间由技能效果生命周期维护，本状态不另设强度数值。","status_kind":"SILENCE"},{"name":"眩晕","status":"ENABLED","game_id":"lol","created_at":"2026-08-28T22:55:06.53067+08:00","sort_order":0,"status_key":"vertigo","updated_at":"2026-08-28T22:55:06.53067+08:00","description":null,"status_kind":"STUN"}]'::jsonb) AS e(game_id text,status_key text,name text,description text,status_kind text,status text,sort_order integer,created_at timestamptz,updated_at timestamptz) EXCEPT ALL SELECT game_id,status_key,name,description,status_kind,status,sort_order,created_at,updated_at FROM public.statuses)
 ) THEN RAISE EXCEPTION '原四条状态含时间戳偏离已核定现值'; END IF;
 IF (SELECT count(*) FROM public.skill_effects)<>973 OR (SELECT count(*) FROM public.skill_object_references)<>9356 THEN RAISE EXCEPTION '效果或引用基线漂移'; END IF;
END
$preflight$;
CREATE TEMP TABLE charm_status_before ON COMMIT DROP AS SELECT to_jsonb(s) AS body FROM public.statuses s;
CREATE TEMP TABLE charm_effects_before ON COMMIT DROP AS SELECT to_jsonb(e) AS body FROM public.skill_effects e;
CREATE TEMP TABLE charm_references_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.skill_object_references r;
ALTER TABLE public.statuses DROP CONSTRAINT ck_statuses_kind;
ALTER TABLE public.statuses ADD CONSTRAINT ck_statuses_kind CHECK (status_kind IN ('STUN','MOVEMENT_SLOW','ROOT','SILENCE','CHARM'));
COMMENT ON COLUMN public.statuses.status_kind IS '状态行为身份：眩晕、普通移动减速、禁锢、沉默或魅惑；创建后不可改';
DO $verify$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND conname='ck_statuses_kind' AND contype='c' AND convalidated AND pg_get_constraintdef(oid)=$new$CHECK (((status_kind)::text = ANY ((ARRAY['STUN'::character varying, 'MOVEMENT_SLOW'::character varying, 'ROOT'::character varying, 'SILENCE'::character varying, 'CHARM'::character varying])::text[])))$new$) THEN RAISE EXCEPTION '魅惑种类约束验证失败'; END IF;
 IF EXISTS ((SELECT body FROM charm_status_before EXCEPT ALL SELECT to_jsonb(s) FROM public.statuses s) UNION ALL (SELECT to_jsonb(s) FROM public.statuses s EXCEPT ALL SELECT body FROM charm_status_before)) OR EXISTS ((SELECT body FROM charm_effects_before EXCEPT ALL SELECT to_jsonb(e) FROM public.skill_effects e) UNION ALL (SELECT to_jsonb(e) FROM public.skill_effects e EXCEPT ALL SELECT body FROM charm_effects_before)) OR EXISTS ((SELECT body FROM charm_references_before EXCEPT ALL SELECT to_jsonb(r) FROM public.skill_object_references r) UNION ALL (SELECT to_jsonb(r) FROM public.skill_object_references r EXCEPT ALL SELECT body FROM charm_references_before)) THEN RAISE EXCEPTION '原状态、效果或引用发生变化，回滚'; END IF;
END
$verify$;
COMMIT;
