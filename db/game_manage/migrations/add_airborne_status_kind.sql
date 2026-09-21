-- 击飞状态行为身份增量；仅用于已冻结并独立审查的 test0221 基线。
-- 不创建状态条目，不改变任何已有业务行。提交不确定时必须先独立核对，禁止重放。
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.statuses IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF current_database() <> 'test0221' THEN RAISE EXCEPTION 'target database mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='statuses'
    AND column_name='status_kind' AND data_type='character varying' AND character_maximum_length=32
    AND is_nullable='NO' AND column_default IS NULL
  ) THEN RAISE EXCEPTION 'status kind column mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.statuses'::regclass
    AND conname='ck_statuses_kind' AND convalidated AND pg_get_constraintdef(oid)='CHECK (((status_kind)::text = ANY ((ARRAY[''STUN''::character varying, ''MOVEMENT_SLOW''::character varying, ''ROOT''::character varying, ''SILENCE''::character varying, ''CHARM''::character varying])::text[])))'
  ) THEN RAISE EXCEPTION 'status kind constraint mismatch'; END IF;
  IF (SELECT col_description('public.statuses'::regclass,attnum) FROM pg_attribute
      WHERE attrelid='public.statuses'::regclass AND attname='status_kind' AND NOT attisdropped)
      IS DISTINCT FROM '状态行为身份：眩晕、普通移动减速、禁锢、沉默或魅惑；创建后不可改'
  THEN RAISE EXCEPTION 'status kind comment mismatch'; END IF;
  IF (SELECT count(*) FROM public.skill_effects) <> 993
    OR (SELECT count(*) FROM public.skill_object_references) <> 9489
  THEN RAISE EXCEPTION 'effect or reference count mismatch'; END IF;
  IF EXISTS (
    WITH expected AS (
      SELECT * FROM jsonb_to_recordset($airborne_statuses$[{"name":"魅惑","status":"ENABLED","game_id":"lol","created_at":"2026-09-20T04:24:19.522892+08:00","sort_order":40,"status_key":"charm","updated_at":"2026-09-20T04:24:19.522892+08:00","description":"魅惑状态身份：目标被迫接近技能来源；具体期限由效果生命周期维护，本状态不另设强度数值。","status_kind":"CHARM"},{"name":"普通移动减速","status":"ENABLED","game_id":"lol","created_at":"2026-09-19T14:37:05.092208+08:00","sort_order":10,"status_key":"movement_slow","updated_at":"2026-09-19T16:22:48.378088+08:00","description":"普通移动减速状态身份；具体减速比例与持续时间由技能效果维护。","status_kind":"MOVEMENT_SLOW"},{"name":"禁锢","status":"ENABLED","game_id":"lol","created_at":"2026-09-19T12:52:01.232803+08:00","sort_order":20,"status_key":"root","updated_at":"2026-09-19T12:52:01.232803+08:00","description":"禁锢状态身份；具体持续时间由技能效果生命周期维护，本状态不另设强度数值。","status_kind":"ROOT"},{"name":"沉默","status":"ENABLED","game_id":"lol","created_at":"2026-09-20T00:42:34.531835+08:00","sort_order":30,"status_key":"silence","updated_at":"2026-09-20T00:42:34.531835+08:00","description":"沉默状态身份；具体持续时间由技能效果生命周期维护，本状态不另设强度数值。","status_kind":"SILENCE"},{"name":"眩晕","status":"ENABLED","game_id":"lol","created_at":"2026-08-28T22:55:06.53067+08:00","sort_order":0,"status_key":"vertigo","updated_at":"2026-08-28T22:55:06.53067+08:00","description":null,"status_kind":"STUN"}]$airborne_statuses$::jsonb)
      AS s(game_id varchar(64),status_key varchar(64),name varchar(100),description varchar(2000),
           status varchar(16),sort_order integer,created_at timestamptz,updated_at timestamptz,status_kind varchar(32))
    ), actual AS (
      SELECT game_id,status_key,name,description,status,sort_order,created_at,updated_at,status_kind FROM public.statuses
    )
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
  ) THEN RAISE EXCEPTION 'status rows differ from frozen baseline'; END IF;
END;
$guard$;
CREATE TEMP TABLE airborne_statuses_before ON COMMIT DROP AS SELECT * FROM public.statuses;
CREATE TEMP TABLE airborne_effects_before ON COMMIT DROP AS SELECT * FROM public.skill_effects;
CREATE TEMP TABLE airborne_references_before ON COMMIT DROP AS SELECT * FROM public.skill_object_references;
ALTER TABLE public.statuses DROP CONSTRAINT ck_statuses_kind;
ALTER TABLE public.statuses ADD CONSTRAINT ck_statuses_kind
  CHECK (status_kind IN ('STUN', 'MOVEMENT_SLOW', 'ROOT', 'SILENCE', 'CHARM', 'AIRBORNE'));
COMMENT ON COLUMN public.statuses.status_kind IS '状态行为身份：眩晕、普通移动减速、禁锢、沉默、魅惑或击飞；创建后不可改';
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND conname='ck_statuses_kind'
    AND convalidated AND pg_get_constraintdef(oid)='CHECK (((status_kind)::text = ANY ((ARRAY[''STUN''::character varying, ''MOVEMENT_SLOW''::character varying, ''ROOT''::character varying, ''SILENCE''::character varying, ''CHARM''::character varying, ''AIRBORNE''::character varying])::text[])))'
  ) THEN RAISE EXCEPTION 'new status kind constraint mismatch'; END IF;
  IF EXISTS ((SELECT * FROM public.statuses EXCEPT ALL SELECT * FROM airborne_statuses_before)
             UNION ALL (SELECT * FROM airborne_statuses_before EXCEPT ALL SELECT * FROM public.statuses))
  THEN RAISE EXCEPTION 'status rows changed'; END IF;
  IF EXISTS ((SELECT * FROM public.skill_effects EXCEPT ALL SELECT * FROM airborne_effects_before)
             UNION ALL (SELECT * FROM airborne_effects_before EXCEPT ALL SELECT * FROM public.skill_effects))
  THEN RAISE EXCEPTION 'effect rows changed'; END IF;
  IF EXISTS ((SELECT * FROM public.skill_object_references EXCEPT ALL SELECT * FROM airborne_references_before)
             UNION ALL (SELECT * FROM airborne_references_before EXCEPT ALL SELECT * FROM public.skill_object_references))
  THEN RAISE EXCEPTION 'reference rows changed'; END IF;
END;
$verify$;
COMMIT;
