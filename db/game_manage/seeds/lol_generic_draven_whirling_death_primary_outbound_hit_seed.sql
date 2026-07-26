-- =============================================================================
-- LoL generic Draven R Whirling Death primary outbound-hit seed
-- （德莱文 R 冷血追命 Phase-A v2 选定主冠军首段出站单次物理命中）
-- file: db/game_manage/seeds/lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql
-- =============================================================================
--
-- 目标：幂等 ensure hero_draven 最低必要基线，并挂载独立 R provider/active ability
--       Whirling Death primary outbound-hit：100 mana、80000ms CD、impact 对
--       opponent 恰好一次 physical damage =
--       400 + 1.50 * (source.attr.ad.resolved - source.attr.ad.base)。
--       AD 为 bonus AD：运行时 sub(resolved, base)；不得直接读 total AD 作为
--       bonus 比率，亦不得省略 ad.base 减法。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate selected-primary-champion
--       single first-outbound-pass hit 为 Phase-A scaffold，不是实际 cast time /
--       direction / projectile travel / collision / sight / recast / reversal /
--       return / homing / second pass / execute / Adoration / multitarget /
--       damage falloff / reset / map edge / once-per-pass geometry / full
--       fidelity。
--       伤害公式必须为嵌套二元算术树（每个算术节点恰好二元；每条 read path
--       恰好一次）：
--         add(const 400, mul(const 1.50, sub(read source.attr.ad.resolved,
--             read source.attr.ad.base)))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_draven|R|冷血追命
-- FROZEN_PLAN_REV=draven-r-whirling-death-primary-outbound-hit-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank3_selected_primary_champion_single_first_outbound_pass_hit; immediate_impact_scaffold; physical_400_plus_1_50_bonus_ad; no_cast_time_direction_projectile_travel_collision_sight_recast_reversal_return_homing_second_pass_execute_adoration_threshold_multitarget_damage_falloff_reset_map_edge_once_per_pass_geometry_or_full_fidelity
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(hp,mana,ad,attack_speed,
--    armor,magic_resist,hp_regen,mana_regen) 缺失则 RAISE EXCEPTION 回滚。
--    恰好八键属性；不要求、不写入 AP。
-- 4. 自包含 ensure hero_draven 实体 + level-1 面板 + mana 资源（361/361）；
--    仅 mount 独立 provider_hero_draven_r_whirling_death_primary_outbound_hit
--    （stable ID 族 hero_draven_r_whirling_death_primary_outbound_hit）。与既有/
--    未来 provider_hero_draven_q_spinning_axe、provider_hero_draven_w_blood_rush、
--    provider_hero_draven_e_stand_aside、provider_hero_draven_basic_attack 并存：
--    不 DELETE、不 UPDATE、不覆盖无关 Q/W/E/普攻 provider 及其 ability/state/
--    effect 行；不读/不依赖其发布顺序；不 require sibling publication。
-- 5. 可执行图：一个 active ability、一个 mana cost、一个 cooldown、一个
--    null-duration impact phase、一个 on_enter sequence、一个 damage step/detail。
--    零 provider state / modifiers / listeners / matchers / explicit events /
--    repeats / control / projectile / geometry / multitarget 行。
-- 6. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；亦不否认游戏内折返/处决/多目标等行为——仅不对本边界建模）：
--   cast time / direction；
--   projectile / travel / collision / sight；
--   recast / reversal / return / homing / second pass；
--   execute / Adoration threshold；
--   multitarget / damage falloff / reset / map edge / once-per-pass geometry；
--   ranks 1–2；Q Spinning Axe / W Blood Rush / E Stand Aside / basic attack /
--   equipment / loadout 耦合；
--   listener / state / event / modifier / repeat / control；
--   live migration；自动 publish；full fidelity。
--
-- 数值来源（League Wiki Template:Data Draven/R → resolved
-- Template:Data Draven/Whirling Death；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon 数值溯源）：
--   request Template:Data Draven/R
--   resolved page Template:Data Draven/Whirling Death
--   wiki pageId 1307072
--   revision id 4040576
--   revision timestamp 2026-07-06T14:27:37Z
--   canonical raw byte size 3079
--   canonical content SHA256
--     e38551b6eeefa0306cd40a3e15473c8983075f88edbe007915e3d9213a08adce
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/draven-r.json
--   siblings：pages/draven-r.json；raw/draven-r.wikitext
--   local raw materialization caveat（非源矛盾）：仓库 local Wasm raw sibling
--     亦 3079 bytes，SHA256
--     1110179b1771c03c8ff67b428d6fa7a5b0ba42caf19e241ce512a199ef812059。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-3 selected primary-champion single first-outbound-pass hit：
--     physical 400 + 150% bonus AD；mana 100；cooldown 80000ms。
--   确定性夹具（注释 only；非 seed 写入；不连 live / 不执行 runtime）：
--     base0/resolved0/armor0 raw/final400；
--     base62/resolved62/armor0 raw/final400；
--     base62/resolved162/armor0 raw/final550；
--     same armor100 raw550/final275；
--     base0/resolved100 vs base62/resolved162 at armor0 both raw/final550
--       （bonusAD counterproof）；
--     mana361/baseAD62/resolvedAD162/targetHP1000/armor100 在
--       t0/t79999/t80000 → success/cooldown skip/success、exactly two R hits
--       and automatic starts、readyAt80000、final mana261/HP725；
--     mana99 → resource skip、unchanged mana/HP、no R damage/start。
--   英雄 level-1 面板（与 Spinning Axe / Blood Rush / Stand Aside seed 对齐）：
--     hp675 mana361 ad62 AS0.679 armor29 MR30 hpregen3.75 manaregen8.05。
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions 已存在。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-draven-whirling-death-primary-outbound-hit-phase-a-v2-20260726

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_missing_attrs      text;
    v_required_reserved  int[] := ARRAY[
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20170, -- value_policy/add
        20220, -- damage/physical
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'mana', 'ad', 'attack_speed', 'armor', 'magic_resist',
        'hp_regen', 'mana_regen'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_draven_whirling_death_primary_outbound_hit_seed: game_id=% missing in public.games',
            v_game_id;
    END IF;

    INSERT INTO public.game_data_state (game_id, current_revision, published_revision, updated_at)
    VALUES (v_game_id, 0, 0, NOW())
    ON CONFLICT (game_id) DO NOTHING;

    SELECT gds.current_revision
      INTO v_locked_current
      FROM public.game_data_state gds
     WHERE gds.game_id = v_game_id
     FOR UPDATE;

    IF v_locked_current IS NULL THEN
        RAISE EXCEPTION
            'lol_generic_draven_whirling_death_primary_outbound_hit_seed: failed to lock game_data_state for %',
            v_game_id;
    END IF;

    v_candidate := v_locked_current + 1;

    SELECT string_agg(req.type_id::text, ', ' ORDER BY req.type_id)
      INTO v_missing_reserved
      FROM unnest(v_required_reserved) AS req(type_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.reserved_type rt
                WHERE rt.type_id = req.type_id
           );

    IF v_missing_reserved IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_draven_whirling_death_primary_outbound_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    SELECT string_agg(req.attr_key, ', ' ORDER BY req.attr_key)
      INTO v_missing_attrs
      FROM unnest(v_required_attrs) AS req(attr_key)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.attribute_definitions ad
                WHERE ad.game_id = v_game_id
                  AND ad.attr_key = req.attr_key
           );

    IF v_missing_attrs IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_draven_whirling_death_primary_outbound_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    )
    SELECT
        v_game_id,
        rt.type_id,
        rt.type_key,
        rt.name,
        NULL,
        rt.type_id,
        v_candidate,
        NOW()
      FROM public.reserved_type rt
     WHERE rt.type_id = ANY (v_required_reserved)
    ON CONFLICT (game_id, type_id) DO UPDATE SET
        type_key = EXCLUDED.type_key,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        reserved_type_id = EXCLUDED.reserved_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.types.type_key IS DISTINCT FROM EXCLUDED.type_key
       OR public.types.name IS DISTINCT FROM EXCLUDED.name
       OR public.types.description IS DISTINCT FROM EXCLUDED.description
       OR public.types.reserved_type_id IS DISTINCT FROM EXCLUDED.reserved_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- 自包含 ensure：hero_draven 基线实体（已存在则不覆盖 display/description）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_draven',
        '德莱文',
        '德莱文 / Draven（Whirling Death primary outbound-hit seed 自包含基线）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- level-1 面板（与 Spinning Axe / Blood Rush / Stand Aside 对齐；已存在且相同则无 material change）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_draven', 'hp', 675, v_candidate, NOW()),
        (v_game_id, 'hero_draven', 'mana', 361, v_candidate, NOW()),
        (v_game_id, 'hero_draven', 'ad', 62, v_candidate, NOW()),
        (v_game_id, 'hero_draven', 'attack_speed', 0.679, v_candidate, NOW()),
        (v_game_id, 'hero_draven', 'armor', 29, v_candidate, NOW()),
        (v_game_id, 'hero_draven', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_draven', 'hp_regen', 3.75, v_candidate, NOW()),
        (v_game_id, 'hero_draven', 'mana_regen', 8.05, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 幂等投影 mana 资源定义（ability_costs FK）
    INSERT INTO public.resource_definitions (
        game_id, resource_key, display_name,
        default_initial_value, default_max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'mana',
        '法力',
        0,
        0,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, resource_key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        default_initial_value = EXCLUDED.default_initial_value,
        default_max_value = EXCLUDED.default_max_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.resource_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR public.resource_definitions.default_initial_value IS DISTINCT FROM EXCLUDED.default_initial_value
       OR public.resource_definitions.default_max_value IS DISTINCT FROM EXCLUDED.default_max_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_resource_values (
        game_id, entity_id, resource_key, initial_value, max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_draven',
        'mana',
        361,
        361,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id, resource_key) DO UPDATE SET
        initial_value = EXCLUDED.initial_value,
        max_value = EXCLUDED.max_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_resource_values.initial_value IS DISTINCT FROM EXCLUDED.initial_value
       OR public.entity_resource_values.max_value IS DISTINCT FROM EXCLUDED.max_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- hero_draven Whirling Death primary outbound-hit（R rank-3）：独立 provider +
    -- active impact 单次物理伤害；不触碰 Q / W / E / basic attack provider
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_draven_r_whirling_death_primary_outbound_hit',
        20120,
        '德莱文 R 冷血追命 Whirling Death primary outbound-hit（Phase-A v2 rank3 首段出站）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, provider_id) DO UPDATE SET
        provider_kind_type_id = EXCLUDED.provider_kind_type_id,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_definitions.provider_kind_type_id IS DISTINCT FROM EXCLUDED.provider_kind_type_id
       OR public.provider_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_draven_r_whirling_death_primary_outbound_hit',
            'r_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_draven_r_whirling_death_primary_outbound_hit',
            'r_cooldown_ms',
            '{"op":"const","value":80000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_draven_r_whirling_death_primary_outbound_hit',
            'whirling_death_primary_outbound_hit_damage',
            '{"op":"add","args":[{"op":"const","value":400},{"op":"mul","args":[{"op":"const","value":1.50},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        )
    ON CONFLICT (game_id, provider_id, formula_key) DO UPDATE SET
        expression = EXCLUDED.expression,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_formulas.expression IS DISTINCT FROM EXCLUDED.expression;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_draven_r_whirling_death_primary_outbound_hit',
        'provider_hero_draven_r_whirling_death_primary_outbound_hit',
        'whirling_death_primary_outbound_hit',
        20130,
        '冷血追命（R）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, ability_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        ability_key = EXCLUDED.ability_key,
        ability_kind_type_id = EXCLUDED.ability_kind_type_id,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_definitions.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.ability_definitions.ability_key IS DISTINCT FROM EXCLUDED.ability_key
       OR public.ability_definitions.ability_kind_type_id IS DISTINCT FROM EXCLUDED.ability_kind_type_id
       OR public.ability_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_costs (
        game_id, cost_id, ability_id, phase_id, resource_key,
        amount_formula_key, allow_partial, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cost_hero_draven_r_whirling_death_primary_outbound_hit_mana',
        'ability_hero_draven_r_whirling_death_primary_outbound_hit',
        NULL,
        'mana',
        'r_mana_cost',
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, cost_id) DO UPDATE SET
        ability_id = EXCLUDED.ability_id,
        phase_id = EXCLUDED.phase_id,
        resource_key = EXCLUDED.resource_key,
        amount_formula_key = EXCLUDED.amount_formula_key,
        allow_partial = EXCLUDED.allow_partial,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_costs.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.ability_costs.phase_id IS DISTINCT FROM EXCLUDED.phase_id
       OR public.ability_costs.resource_key IS DISTINCT FROM EXCLUDED.resource_key
       OR public.ability_costs.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.ability_costs.allow_partial IS DISTINCT FROM EXCLUDED.allow_partial;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_cooldowns (
        game_id, cooldown_id, ability_id, duration_formula_key,
        starts_on_phase_id, group_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cooldown_hero_draven_r_whirling_death_primary_outbound_hit',
        'ability_hero_draven_r_whirling_death_primary_outbound_hit',
        'r_cooldown_ms',
        NULL,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, cooldown_id) DO UPDATE SET
        ability_id = EXCLUDED.ability_id,
        duration_formula_key = EXCLUDED.duration_formula_key,
        starts_on_phase_id = EXCLUDED.starts_on_phase_id,
        group_key = EXCLUDED.group_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_cooldowns.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.ability_cooldowns.duration_formula_key IS DISTINCT FROM EXCLUDED.duration_formula_key
       OR public.ability_cooldowns.starts_on_phase_id IS DISTINCT FROM EXCLUDED.starts_on_phase_id
       OR public.ability_cooldowns.group_key IS DISTINCT FROM EXCLUDED.group_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- null-duration impact phase：assembler 产出一次立即 operation
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_draven_r_whirling_death_primary_outbound_hit_impact',
        'ability_hero_draven_r_whirling_death_primary_outbound_hit',
        0,
        20142,
        NULL,
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, phase_id) DO UPDATE SET
        ability_id = EXCLUDED.ability_id,
        phase_order = EXCLUDED.phase_order,
        phase_type_id = EXCLUDED.phase_type_id,
        duration_formula_key = EXCLUDED.duration_formula_key,
        interruptible = EXCLUDED.interruptible,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_phases.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.ability_phases.phase_order IS DISTINCT FROM EXCLUDED.phase_order
       OR public.ability_phases.phase_type_id IS DISTINCT FROM EXCLUDED.phase_type_id
       OR public.ability_phases.duration_formula_key IS DISTINCT FROM EXCLUDED.duration_formula_key
       OR public.ability_phases.interruptible IS DISTINCT FROM EXCLUDED.interruptible;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_draven_r_whirling_death_primary_outbound_hit_impact',
        'provider_hero_draven_r_whirling_death_primary_outbound_hit',
        'whirling_death_primary_outbound_hit_impact',
        '冷血追命 impact（选定主冠军首段出站单次物理伤害）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, sequence_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        sequence_key = EXCLUDED.sequence_key,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.effect_sequences.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.effect_sequences.sequence_key IS DISTINCT FROM EXCLUDED.sequence_key
       OR public.effect_sequences.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- deferred exactly-one-detail：damage 配一 damage_effect_details
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_draven_r_whirling_death_primary_outbound_hit_damage',
        'sequence_hero_draven_r_whirling_death_primary_outbound_hit_impact',
        0,
        20150,
        20111,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        sequence_id = EXCLUDED.sequence_id,
        step_order = EXCLUDED.step_order,
        operation_type_id = EXCLUDED.operation_type_id,
        target_selector_type_id = EXCLUDED.target_selector_type_id,
        condition_formula_key = EXCLUDED.condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.effect_steps.sequence_id IS DISTINCT FROM EXCLUDED.sequence_id
       OR public.effect_steps.step_order IS DISTINCT FROM EXCLUDED.step_order
       OR public.effect_steps.operation_type_id IS DISTINCT FROM EXCLUDED.operation_type_id
       OR public.effect_steps.target_selector_type_id IS DISTINCT FROM EXCLUDED.target_selector_type_id
       OR public.effect_steps.condition_formula_key IS DISTINCT FROM EXCLUDED.condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        copyable_on_hit, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_draven_r_whirling_death_primary_outbound_hit_damage',
        'whirling_death_primary_outbound_hit_damage',
        20220,
        20170,
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        copyable_on_hit = EXCLUDED.copyable_on_hit,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id
       OR public.damage_effect_details.copyable_on_hit IS DISTINCT FROM EXCLUDED.copyable_on_hit;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_draven_r_whirling_death_primary_outbound_hit_impact',
        20260,
        'sequence_hero_draven_r_whirling_death_primary_outbound_hit_impact',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, phase_id, trigger_type_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_phase_effect_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_provider_mounts (
        game_id, entity_id, provider_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_draven',
        'provider_hero_draven_r_whirling_death_primary_outbound_hit',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id, provider_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_provider_mounts.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    IF v_changed THEN
        UPDATE public.game_data_state
           SET current_revision = v_candidate,
               updated_at = NOW()
         WHERE game_id = v_game_id;
    END IF;
END $$;

COMMIT;
