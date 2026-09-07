-- 当前聚合存储：扩充来源对象初始化事件，不修改业务行或其他约束。
-- 单条 ALTER TABLE 原子替换同名约束，并验证全部已有行。
ALTER TABLE public.skill_trigger_rules
    DROP CONSTRAINT ck_skill_trigger_rules_event_type,
    ADD CONSTRAINT ck_skill_trigger_rules_event_type
        CHECK (event_type IN (
            'SOURCE_INITIALIZED', 'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'SKILL_HIT',
            'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT',
            'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED',
            'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED',
            'CONTROL_RECEIVED', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
            'KILL', 'PROCESS_CANCEL_REQUESTED', 'SPELL_SHIELD_BLOCKED',
            'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED'
        ));
