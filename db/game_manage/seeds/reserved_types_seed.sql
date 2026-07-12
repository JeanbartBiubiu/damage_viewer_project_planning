-- =============================================================================
-- Reserved Type Registry Seed
-- =============================================================================
--
-- reserved_type.type_id is the cross-module stable numeric reference.
-- reserved_type.type_key is the cross-module semantic source of truth.
-- Reserved type ID ranges:
-- - 10000-19999: first-level reserved groups.
-- - 20000-29999: second-level reserved semantics.
-- public.types.type_id is still game-local business data; allocate it from 30000.
-- Application code should resolve a game's concrete typeId by matching
-- types.reserved_type_id or types.type_key.
--
-- Idempotent: ON CONFLICT updates name/type_key.

INSERT INTO public.reserved_type (type_id, name, type_key)
VALUES
    -- existing attribute / wasm validation groups
    (10000, '属性录入分组', 'attribute_entry_group'),
    (10002, 'Wasm 模拟验证状态', 'wasm_sim_validation_status'),
    (20000, '人物成长属性', 'attribute_hero_progression'),
    (20001, '机制属性', 'attribute_mechanic_only'),
    (20010, '单攻击方 DPS 已验证可选', 'wasm_sim_dps_attacker_verified'),

    -- first-level semantic groups
    (10010, '值类型', 'value_type'),
    (10011, '目标选择器', 'selector'),
    (10012, 'Provider 种类', 'provider_kind'),
    (10013, 'Ability 种类', 'ability_kind'),
    (10014, 'Ability 阶段', 'ability_phase'),
    (10015, 'Effect 操作', 'operation'),
    (10016, '数值策略', 'value_policy'),
    (10017, '匹配模式', 'match_mode'),
    (10018, '刷新策略', 'refresh_policy'),
    (10019, '事件', 'event'),
    (10020, '伤害类型', 'damage'),
    (10021, 'Provider 动作', 'provider_action'),
    (10022, 'Ability 控制动作', 'ability_control_action'),
    (10023, '状态作用域', 'state_scope'),
    (10024, '阶段触发点', 'phase_trigger'),

    -- value_type
    (20100, '数值', 'value_type/number'),
    (20101, '布尔', 'value_type/boolean'),
    (20102, '字符串', 'value_type/string'),
    (20103, '时间戳', 'value_type/timestamp'),
    (20104, '实体引用', 'value_type/entity_ref'),

    -- selector
    (20110, '自身', 'selector/self'),
    (20111, '对手', 'selector/opponent'),
    (20112, '来源', 'selector/source'),
    (20113, '目标', 'selector/target'),

    -- provider_kind
    (20120, '被动', 'provider_kind/passive'),
    (20121, '状态', 'provider_kind/status'),
    (20122, '装备', 'provider_kind/equipment'),
    (20123, '符文', 'provider_kind/rune'),
    (20124, '强化', 'provider_kind/augment'),

    -- ability_kind
    (20130, '主动', 'ability_kind/active'),
    (20131, '被动能力', 'ability_kind/passive'),
    (20132, 'Tick 能力', 'ability_kind/tick'),

    -- ability_phase
    (20140, '前摇', 'ability_phase/cast'),
    (20141, '引导', 'ability_phase/channel'),
    (20142, '生效', 'ability_phase/impact'),
    (20143, '周期', 'ability_phase/tick'),
    (20144, '后摇', 'ability_phase/recovery'),

    -- operation
    (20150, '伤害', 'operation/damage'),
    (20151, '治疗', 'operation/heal'),
    (20152, '资源变化', 'operation/resource_change'),
    (20153, '属性变化', 'operation/attribute_change'),
    (20154, '护盾', 'operation/shield'),
    (20155, '施加 Provider', 'operation/apply_provider'),
    (20156, '刷新 Provider', 'operation/refresh_provider'),
    (20157, '移除 Provider', 'operation/expire_provider'),
    (20158, '发出事件', 'operation/emit_event'),
    (20159, '冷却变化', 'operation/cooldown_change'),
    (20160, '状态变化', 'operation/state_change'),

    -- value_policy / modifier_mode
    (20170, '加法', 'value_policy/add'),
    (20171, '乘法', 'value_policy/multiply'),
    (20172, '覆盖', 'value_policy/override'),
    (20173, '百分比加法', 'value_policy/percent_add'),
    (20174, '取最小', 'value_policy/min'),
    (20175, '取最大', 'value_policy/max'),

    -- match_mode
    (20180, '匹配任一', 'match_mode/any'),
    (20181, '匹配全部', 'match_mode/all'),
    (20182, '匹配全无', 'match_mode/none'),

    -- refresh_policy
    (20190, '刷新持续时间', 'refresh_policy/refresh_duration'),
    (20191, '增加层数', 'refresh_policy/add_stack'),
    (20192, '重置层数', 'refresh_policy/reset_stack'),
    (20193, '忽略', 'refresh_policy/ignore'),

    -- event (stable Wasm/Web vocabulary)
    (20200, '造成伤害', 'event/damage_dealt'),
    (20201, '受到伤害', 'event/damage_taken'),
    (20202, '造成治疗', 'event/heal_dealt'),
    (20203, '受到治疗', 'event/heal_taken'),
    (20204, '资源变化', 'event/resource_changed'),
    (20205, '能力开始', 'event/ability_started'),
    (20206, '能力结束', 'event/ability_ended'),
    (20207, 'Provider 施加', 'event/provider_applied'),
    (20208, 'Provider 刷新', 'event/provider_refreshed'),
    (20209, 'Provider 过期', 'event/provider_expired'),
    (20210, 'Tick', 'event/tick'),

    -- damage
    (20220, '物理伤害', 'damage/physical'),
    (20221, '魔法伤害', 'damage/magic'),
    (20222, '真实伤害', 'damage/true'),

    -- provider_action (for provider_effect_details.action_type_id)
    (20230, '施加', 'provider_action/apply'),
    (20231, '刷新', 'provider_action/refresh'),
    (20232, '过期', 'provider_action/expire'),

    -- ability_control_action
    (20240, '打断', 'ability_control_action/interrupt'),
    (20241, '取消', 'ability_control_action/cancel'),
    (20242, '强制结束', 'ability_control_action/force_end'),

    -- state_scope
    (20250, 'Provider 状态', 'state_scope/provider'),
    (20251, 'Ability 状态', 'state_scope/ability'),

    -- phase_trigger
    (20260, '进入阶段', 'phase_trigger/on_enter'),
    (20261, '离开阶段', 'phase_trigger/on_exit'),
    (20262, '阶段 Tick', 'phase_trigger/on_tick')
ON CONFLICT (type_id) DO UPDATE SET
    name = EXCLUDED.name,
    type_key = EXCLUDED.type_key;

INSERT INTO public.reserved_type_relation (type_id, parent_type_id)
VALUES
    (20000, 10000),
    (20001, 10000),
    (20010, 10002),

    (20100, 10010),
    (20101, 10010),
    (20102, 10010),
    (20103, 10010),
    (20104, 10010),

    (20110, 10011),
    (20111, 10011),
    (20112, 10011),
    (20113, 10011),

    (20120, 10012),
    (20121, 10012),
    (20122, 10012),
    (20123, 10012),
    (20124, 10012),

    (20130, 10013),
    (20131, 10013),
    (20132, 10013),

    (20140, 10014),
    (20141, 10014),
    (20142, 10014),
    (20143, 10014),
    (20144, 10014),

    (20150, 10015),
    (20151, 10015),
    (20152, 10015),
    (20153, 10015),
    (20154, 10015),
    (20155, 10015),
    (20156, 10015),
    (20157, 10015),
    (20158, 10015),
    (20159, 10015),
    (20160, 10015),

    (20170, 10016),
    (20171, 10016),
    (20172, 10016),
    (20173, 10016),
    (20174, 10016),
    (20175, 10016),

    (20180, 10017),
    (20181, 10017),
    (20182, 10017),

    (20190, 10018),
    (20191, 10018),
    (20192, 10018),
    (20193, 10018),

    (20200, 10019),
    (20201, 10019),
    (20202, 10019),
    (20203, 10019),
    (20204, 10019),
    (20205, 10019),
    (20206, 10019),
    (20207, 10019),
    (20208, 10019),
    (20209, 10019),
    (20210, 10019),

    (20220, 10020),
    (20221, 10020),
    (20222, 10020),

    (20230, 10021),
    (20231, 10021),
    (20232, 10021),

    (20240, 10022),
    (20241, 10022),
    (20242, 10022),

    (20250, 10023),
    (20251, 10023),

    (20260, 10024),
    (20261, 10024),
    (20262, 10024)
ON CONFLICT (type_id, parent_type_id) DO NOTHING;
