-- 仅用于已完成普通减速迁移、已核定的 test0221 原库；执行方先确认连接 192.168.5.6:5432。
-- 只追加禁锢身份，不新增状态记录。旧减速迁移及工具保持冻结，禁止重放。
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.statuses IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
    IF current_database() <> 'test0221' THEN
        RAISE EXCEPTION '禁锢种类迁移仅允许已核定的 test0221 数据库';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'statuses' AND column_name = 'status_kind'
          AND data_type = 'character varying' AND character_maximum_length = 32
          AND is_nullable = 'NO' AND column_default IS NULL) THEN
        RAISE EXCEPTION 'status_kind 必须已存在、非空、无默认值且为 varchar(32)，停止迁移';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.statuses'::regclass AND conname = 'ck_statuses_kind'
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) =
            $old$CHECK (((status_kind)::text = ANY ((ARRAY['STUN'::character varying, 'MOVEMENT_SLOW'::character varying])::text[])))$old$) THEN
        RAISE EXCEPTION '状态种类约束偏离已核定的 STUN/MOVEMENT_SLOW；禁止重复或漂移迁移';
    END IF;
    IF (SELECT count(*) FROM public.statuses) <> 1
        OR NOT EXISTS (SELECT 1 FROM public.statuses
            WHERE game_id = 'lol' AND status_key = 'vertigo' AND name = '眩晕' AND status_kind = 'STUN'
              AND description IS NULL AND status = 'ENABLED' AND sort_order = 0
              AND created_at = timestamptz '2026-08-28 22:55:06.53067+08'
              AND updated_at = timestamptz '2026-08-28 22:55:06.53067+08') THEN
        RAISE EXCEPTION '状态现值偏离唯一已核定的 vertigo/STUN，停止迁移';
    END IF;
    IF (SELECT count(*) FROM public.skill_effects) <> 923
        OR (SELECT count(*) FROM public.skill_object_references) <> 9026 THEN
        RAISE EXCEPTION '效果或引用数量偏离已核定基线，停止迁移并重新核对';
    END IF;
END
$preflight$;

CREATE TEMP TABLE root_status_before ON COMMIT DROP AS SELECT to_jsonb(s) AS body FROM public.statuses s;
CREATE TEMP TABLE root_effects_before ON COMMIT DROP AS SELECT to_jsonb(e) AS body FROM public.skill_effects e;
CREATE TEMP TABLE root_references_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.skill_object_references r;

ALTER TABLE public.statuses DROP CONSTRAINT ck_statuses_kind;
ALTER TABLE public.statuses ADD CONSTRAINT ck_statuses_kind CHECK (status_kind IN ('STUN', 'MOVEMENT_SLOW', 'ROOT'));
COMMENT ON COLUMN public.statuses.status_kind IS '状态行为身份：眩晕、普通移动减速或禁锢；创建后不可改';

DO $verify$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.statuses'::regclass AND conname = 'ck_statuses_kind'
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) =
            $new$CHECK (((status_kind)::text = ANY ((ARRAY['STUN'::character varying, 'MOVEMENT_SLOW'::character varying, 'ROOT'::character varying])::text[])))$new$)
        OR NOT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses' AND column_name = 'status_kind'
              AND data_type = 'character varying' AND character_maximum_length = 32
              AND is_nullable = 'NO' AND column_default IS NULL) THEN
        RAISE EXCEPTION '禁锢种类约束或列定义验证失败，回滚迁移';
    END IF;
    IF EXISTS ((SELECT body FROM root_status_before EXCEPT ALL SELECT to_jsonb(s) FROM public.statuses s)
        UNION ALL (SELECT to_jsonb(s) FROM public.statuses s EXCEPT ALL SELECT body FROM root_status_before))
        OR EXISTS ((SELECT body FROM root_effects_before EXCEPT ALL SELECT to_jsonb(e) FROM public.skill_effects e)
        UNION ALL (SELECT to_jsonb(e) FROM public.skill_effects e EXCEPT ALL SELECT body FROM root_effects_before))
        OR EXISTS ((SELECT body FROM root_references_before EXCEPT ALL SELECT to_jsonb(r) FROM public.skill_object_references r)
        UNION ALL (SELECT to_jsonb(r) FROM public.skill_object_references r EXCEPT ALL SELECT body FROM root_references_before)) THEN
        RAISE EXCEPTION '原状态、时间戳、效果或引用被改变，回滚迁移';
    END IF;
END
$verify$;
COMMIT;
