-- 仅用于已核定的 test0221 原库；新库直接执行当前 schema.sql。
-- 方案：普通减速强度-2026-09-19-v1。任何现值偏离均抛错并回滚，禁止猜测状态身份。
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.statuses IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
    IF current_database() <> 'test0221' THEN
        RAISE EXCEPTION '状态种类迁移仅允许已核定的 test0221 数据库';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'statuses' AND column_name = 'status_kind') THEN
        RAISE EXCEPTION 'status_kind 已存在；禁止重放迁移';
    END IF;
    IF (SELECT count(*) FROM public.statuses) <> 1
        OR NOT EXISTS (SELECT 1 FROM public.statuses
            WHERE game_id = 'lol' AND status_key = 'vertigo' AND name = '眩晕'
              AND description IS NULL AND status = 'ENABLED' AND sort_order = 0
              AND created_at = timestamptz '2026-08-28 22:55:06.53067+08'
              AND updated_at = timestamptz '2026-08-28 22:55:06.53067+08') THEN
        RAISE EXCEPTION '状态现值偏离唯一已核定眩晕，停止迁移';
    END IF;
    IF (SELECT count(*) FROM public.skill_object_references WHERE target_type = 'STATUS') <> 1
        OR NOT EXISTS (SELECT 1 FROM public.skill_object_references
            WHERE game_id = 'lol' AND source_skill_key = 'veigar_e' AND source_type = 'EFFECT'
              AND source_key = 'event_horizon_stun' AND field_path = 'results[0].detail.statusKey'
              AND target_type = 'STATUS' AND target_skill_key = ''
              AND target_key = 'vertigo' AND target_sub_key = '') THEN
        RAISE EXCEPTION '状态引用偏离已核定的事件视界眩晕，停止迁移';
    END IF;
    IF (SELECT count(*) FROM public.skill_effects e
        CROSS JOIN LATERAL jsonb_array_elements(e.results) r(value)
        WHERE r.value->>'resultType' = 'STATUS_OPERATION') <> 1
        OR NOT EXISTS (SELECT 1 FROM public.skill_effects e
            WHERE e.game_id = 'lol' AND e.skill_key = 'veigar_e' AND e.effect_key = 'event_horizon_stun'
              AND e.results->0 = $result${
                "name":"事件视界眩晕","detail":{"operation":"APPLY","statusKey":"vertigo"},
                "target":"TARGET","resultKey":"stun","sortOrder":10,"valueRule":null,
                "resultType":"STATUS_OPERATION",
                "description":"状态施加时按当前结果参与法术护盾判断；成功施加后随本次来源与目标实例到期结束。",
                "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":null,"stackValueMode":null,
                    "periodicExecutionMode":null,"reapplicationValueMode":null},"spellShieldBlockScope":"RESULT"
              }$result$::jsonb) THEN
        RAISE EXCEPTION '状态效果正文偏离已核定的无强度眩晕，停止迁移';
    END IF;
END
$preflight$;

CREATE TEMP TABLE slow_status_before ON COMMIT DROP AS SELECT to_jsonb(s) AS body FROM public.statuses s;
CREATE TEMP TABLE slow_effects_before ON COMMIT DROP AS SELECT to_jsonb(e) AS body FROM public.skill_effects e;
CREATE TEMP TABLE slow_references_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.skill_object_references r;

-- 已通过精确现值断言后，用新增列的临时常量默认值回填；不 UPDATE 行，保留原时间戳。
ALTER TABLE public.statuses ADD COLUMN status_kind varchar(32) NOT NULL DEFAULT 'STUN';
ALTER TABLE public.statuses ALTER COLUMN status_kind DROP DEFAULT;
ALTER TABLE public.statuses ADD CONSTRAINT ck_statuses_kind CHECK (status_kind IN ('STUN', 'MOVEMENT_SLOW'));
COMMENT ON COLUMN public.statuses.status_kind IS '状态行为身份：眩晕或普通移动减速；创建后不可改';

DO $verify$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'statuses' AND column_name = 'status_kind'
          AND (is_nullable <> 'NO' OR column_default IS NOT NULL))
        OR (SELECT count(*) FROM public.statuses WHERE status_kind = 'STUN') <> 1 THEN
        RAISE EXCEPTION '状态种类非空、无默认值或唯一回填检查失败';
    END IF;
    IF EXISTS ((SELECT body FROM slow_status_before EXCEPT SELECT to_jsonb(s) - 'status_kind' FROM public.statuses s)
        UNION ALL (SELECT to_jsonb(s) - 'status_kind' FROM public.statuses s EXCEPT SELECT body FROM slow_status_before))
        OR EXISTS ((SELECT body FROM slow_effects_before EXCEPT SELECT to_jsonb(e) FROM public.skill_effects e)
        UNION ALL (SELECT to_jsonb(e) FROM public.skill_effects e EXCEPT SELECT body FROM slow_effects_before))
        OR EXISTS ((SELECT body FROM slow_references_before EXCEPT SELECT to_jsonb(r) FROM public.skill_object_references r)
        UNION ALL (SELECT to_jsonb(r) FROM public.skill_object_references r EXCEPT SELECT body FROM slow_references_before)) THEN
        RAISE EXCEPTION '原状态字段、时间戳、效果或引用被改变，回滚迁移';
    END IF;
END
$verify$;
COMMIT;
