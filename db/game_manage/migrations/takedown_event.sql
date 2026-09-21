-- 已核定test0221的参与击杀事件增量；执行方先核对目标主机和独立审查摘要。
-- 只扩充事件约束，不更新业务数据；重复执行或基线漂移均拒绝。
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.skill_trigger_rules IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
 IF current_database() <> 'test0221' THEN RAISE EXCEPTION '参与击杀迁移目标库不符'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.skill_trigger_rules'::regclass AND conname='ck_skill_trigger_rules_event_type' AND contype='c' AND convalidated AND pg_get_constraintdef(oid)=$old$CHECK (((event_type)::text = ANY ((ARRAY['SOURCE_INITIALIZED'::character varying, 'SKILL_USED'::character varying, 'BASIC_ATTACK_START'::character varying, 'BASIC_ATTACK_HIT'::character varying, 'SKILL_HIT'::character varying, 'PROCESS_MOMENT'::character varying, 'RESULT_AVAILABLE'::character varying, 'LIFECYCLE_MOMENT'::character varying, 'DAMAGE_PENDING'::character varying, 'DAMAGE_DEALT'::character varying, 'DAMAGE_TAKEN'::character varying, 'STATUS_CHANGED'::character varying, 'HEALTH_THRESHOLD_CROSSED'::character varying, 'INTERNAL_STATE_CHANGED'::character varying, 'CONTROL_RECEIVED'::character varying, 'ENTITY_DIED'::character varying, 'ENTITY_UNTARGETABLE'::character varying, 'KILL'::character varying, 'PROCESS_CANCEL_REQUESTED'::character varying, 'SPELL_SHIELD_BLOCKED'::character varying, 'HIT_LINK_APPLIED'::character varying, 'ATTACK_LINK_APPLIED'::character varying])::text[])))$old$) THEN RAISE EXCEPTION '旧事件约束漂移或已执行，禁止重放'; END IF;
 IF (SELECT count(*) FROM public.skill_trigger_rules) <> 302 OR (SELECT count(*) FROM public.skill_effects) <> 981 OR (SELECT count(*) FROM public.skill_object_references) <> 9406 THEN RAISE EXCEPTION '规则、效果或引用基线漂移'; END IF;
END
$preflight$;
CREATE TEMP TABLE takedown_rules_before ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.skill_trigger_rules t;
CREATE TEMP TABLE takedown_effects_before ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.skill_effects t;
CREATE TEMP TABLE takedown_refs_before ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.skill_object_references t;
ALTER TABLE public.skill_trigger_rules DROP CONSTRAINT ck_skill_trigger_rules_event_type;
ALTER TABLE public.skill_trigger_rules ADD CONSTRAINT ck_skill_trigger_rules_event_type
 CHECK (event_type IN ('SOURCE_INITIALIZED', 'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'SKILL_HIT', 'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT', 'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED', 'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED', 'CONTROL_RECEIVED', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE', 'KILL', 'TAKEDOWN', 'PROCESS_CANCEL_REQUESTED', 'SPELL_SHIELD_BLOCKED', 'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED'));
DO $verify$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.skill_trigger_rules'::regclass AND conname='ck_skill_trigger_rules_event_type' AND contype='c' AND convalidated AND pg_get_constraintdef(oid)=$new$CHECK (((event_type)::text = ANY ((ARRAY['SOURCE_INITIALIZED'::character varying, 'SKILL_USED'::character varying, 'BASIC_ATTACK_START'::character varying, 'BASIC_ATTACK_HIT'::character varying, 'SKILL_HIT'::character varying, 'PROCESS_MOMENT'::character varying, 'RESULT_AVAILABLE'::character varying, 'LIFECYCLE_MOMENT'::character varying, 'DAMAGE_PENDING'::character varying, 'DAMAGE_DEALT'::character varying, 'DAMAGE_TAKEN'::character varying, 'STATUS_CHANGED'::character varying, 'HEALTH_THRESHOLD_CROSSED'::character varying, 'INTERNAL_STATE_CHANGED'::character varying, 'CONTROL_RECEIVED'::character varying, 'ENTITY_DIED'::character varying, 'ENTITY_UNTARGETABLE'::character varying, 'KILL'::character varying, 'TAKEDOWN'::character varying, 'PROCESS_CANCEL_REQUESTED'::character varying, 'SPELL_SHIELD_BLOCKED'::character varying, 'HIT_LINK_APPLIED'::character varying, 'ATTACK_LINK_APPLIED'::character varying])::text[])))$new$) THEN RAISE EXCEPTION '新事件约束验证失败'; END IF;
 IF EXISTS ((SELECT body FROM takedown_rules_before EXCEPT ALL SELECT to_jsonb(t) FROM public.skill_trigger_rules t) UNION ALL (SELECT to_jsonb(t) FROM public.skill_trigger_rules t EXCEPT ALL SELECT body FROM takedown_rules_before)) OR EXISTS ((SELECT body FROM takedown_effects_before EXCEPT ALL SELECT to_jsonb(t) FROM public.skill_effects t) UNION ALL (SELECT to_jsonb(t) FROM public.skill_effects t EXCEPT ALL SELECT body FROM takedown_effects_before)) OR EXISTS ((SELECT body FROM takedown_refs_before EXCEPT ALL SELECT to_jsonb(t) FROM public.skill_object_references t) UNION ALL (SELECT to_jsonb(t) FROM public.skill_object_references t EXCEPT ALL SELECT body FROM takedown_refs_before)) THEN RAISE EXCEPTION '规则、效果或引用发生变化，回滚'; END IF;
END
$verify$;
COMMIT;
