-- 新增过程命中结算后事实；只扩大一项 CHECK，不修改业务行或重建技能触发器。
-- 调用方先核对目标、文件摘要和只读预检；提交结果不明时先独立读回，不得重放。
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.skill_trigger_rules IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE process_resolved_expected (
    event_type varchar(32),
    CONSTRAINT old_event CHECK (event_type IN (
        'SOURCE_INITIALIZED', 'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'BASIC_ATTACK_RECEIVED', 'SKILL_HIT',
        'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT',
        'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED',
        'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED',
        'CONTROL_RECEIVED', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'KILL', 'TAKEDOWN', 'PROCESS_CANCEL_REQUESTED', 'SPELL_SHIELD_BLOCKED',
        'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED'
    )),
    CONSTRAINT new_event CHECK (event_type IN (
        'SOURCE_INITIALIZED', 'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'BASIC_ATTACK_RECEIVED', 'SKILL_HIT',
        'PROCESS_MOMENT', 'PROCESS_RESOLVED', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT',
        'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED',
        'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED',
        'CONTROL_RECEIVED', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'KILL', 'TAKEDOWN', 'PROCESS_CANCEL_REQUESTED', 'SPELL_SHIELD_BLOCKED',
        'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED'
    ))
) ON COMMIT DROP;
DO $preflight$
BEGIN
    IF current_database() <> 'test0221' THEN RAISE EXCEPTION '过程已结算事件迁移目标库不符'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint actual JOIN pg_constraint expected
          ON expected.conrelid = 'pg_temp.process_resolved_expected'::regclass AND expected.conname = 'old_event'
        WHERE actual.conrelid = 'public.skill_trigger_rules'::regclass
          AND actual.conname = 'ck_skill_trigger_rules_event_type' AND actual.contype = 'c' AND actual.convalidated
          AND pg_get_constraintdef(actual.oid) = pg_get_constraintdef(expected.oid)
    ) THEN RAISE EXCEPTION '事件约束漂移或已执行，禁止重放'; END IF;
END
$preflight$;
CREATE TEMP TABLE process_resolved_before ON COMMIT DROP AS
    SELECT to_jsonb(r) AS body FROM public.skill_trigger_rules r;
ALTER TABLE public.skill_trigger_rules
    DROP CONSTRAINT ck_skill_trigger_rules_event_type,
    ADD CONSTRAINT ck_skill_trigger_rules_event_type CHECK (event_type IN (
        'SOURCE_INITIALIZED', 'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'BASIC_ATTACK_RECEIVED', 'SKILL_HIT',
        'PROCESS_MOMENT', 'PROCESS_RESOLVED', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT',
        'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED',
        'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED',
        'CONTROL_RECEIVED', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'KILL', 'TAKEDOWN', 'PROCESS_CANCEL_REQUESTED', 'SPELL_SHIELD_BLOCKED',
        'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED'
    ));
DO $verify$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint actual JOIN pg_constraint expected
          ON expected.conrelid = 'pg_temp.process_resolved_expected'::regclass AND expected.conname = 'new_event'
        WHERE actual.conrelid = 'public.skill_trigger_rules'::regclass
          AND actual.conname = 'ck_skill_trigger_rules_event_type' AND actual.contype = 'c' AND actual.convalidated
          AND pg_get_constraintdef(actual.oid) = pg_get_constraintdef(expected.oid)
    ) THEN RAISE EXCEPTION '过程已结算事件新约束验证失败'; END IF;
    IF EXISTS (
        (SELECT body FROM process_resolved_before EXCEPT ALL SELECT to_jsonb(r) FROM public.skill_trigger_rules r)
        UNION ALL
        (SELECT to_jsonb(r) FROM public.skill_trigger_rules r EXCEPT ALL SELECT body FROM process_resolved_before)
    ) THEN RAISE EXCEPTION '过程已结算事件迁移改变了业务行或时间戳'; END IF;
END
$verify$;
COMMIT;
