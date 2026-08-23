-- =============================================================================
-- LoL generic Akshan Q Avengerang first-outbound-hit seed
-- （艾克尚 Q 去而复还 Phase-A v2 选定主冠军首段出站单次物理命中）
-- =============================================================================
--
-- 目标：在 lol_generic_akshan_dirty_fighting_seed.sql 已提供 hero_akshan /
--       ad·mana 面板 EAV / provider_hero_akshan_basic_attack（Dirty Fighting
--       普攻图）但**未**写入 mana 资源表行的前提下，挂载独立 Q provider/active
--       ability Avengerang first outbound hit：80 mana、5000ms CD、impact 对
--       opponent（champion）恰好一次 physical damage =
--       165 + 0.70 * (source.attr.ad.resolved - source.attr.ad.base)。
--       AD 为 bonus AD：运行时 sub(resolved, base)；不得直接读 total AD 作为
--       bonus 比率，亦不得省略 ad.base 减法。
--       规范投影为立即主目标 impact + cooldown scaffold（null-duration phase +
--       on_enter sequence → 单一 damage 操作；CD 挂在 ability 级）。Immediate
--       selected-primary-champion first-outbound-hit physical damage/CD
--       scaffold 为 Phase-A，不是实际 direction / range / extension / return
--       pass / homing / projectile travel / cooldown-start-after-return /
--       sight / reveal / movement speed / non-champion damage / spellshield /
--       full-Q fidelity。真实 Wiki CD「Starts after the boomerang returns」
--       被明确排除，不 claim 保真。
--       伤害公式必须为嵌套二元算术树（每个算术节点恰好二元；每条 read path
--       恰好一次）：
--         add(const 165, mul(const 0.70, sub(read source.attr.ad.resolved,
--             read source.attr.ad.base)))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_akshan|Q|去而复还
-- task key：wasm-generic-akshan-avengerang-first-outbound-hit
-- FROZEN_PLAN_REV=akshan-q-avengerang-first-outbound-hit-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. bonus_ad_ratio
--   4. immediate_impact_scaffold
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进
--    （newest material-change-only seed shape）。
-- 3. Hard prerequisites（fail-closed check-only，图写入前）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260
--        （显式含 20220=damage/physical 与 20170=value_policy/add；不含 20230）；
--      - attribute_definitions(lol,{ad,mana})；
--      - game_entities(lol,hero_akshan)；
--      - entity_attribute_values(lol,hero_akshan,{ad,mana})——mana 为面板 EAV。
--    显式前置 seed：lol_generic_akshan_dirty_fighting_seed.sql（owns hero/
--    panel/provider_hero_akshan_basic_attack Dirty Fighting 普攻图；**无**
-- 4. Frozen option A — 最小中性 mana 资源写入（仅缺席时插入；永不 UPDATE/
--    overwrite/delete 既有行）：
--        DO NOTHING；
--        均从同事务内既有 Akshan mana 面板属性 base_value 派生；ON CONFLICT
--        DO NOTHING；永不硬编码面板 mana 字面量（如 350）。
--    允许 ensure 的其它共享行：仅从既有 reserved 投影 game-local types。
--    禁止写入：不对 attribute_definitions / game_entities /
--    entity_attribute_values 做 INSERT/UPDATE/MERGE/DELETE；不对既有
--    Dirty Fighting / basic provider 图做 UPDATE/DELETE/重建。
--    仓库真相：physical damage type `20220`；add policy `20170`；
--    `20230=provider_action/apply` 不得进入可执行图或 required reserved 列表
--    （本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_akshan_q_avengerang_first_outbound_hit
--    （stable ID 族 hero_akshan_q_avengerang_first_outbound_hit）及其隔离 Q 图：
--    一个 provider、一个 active ability（ability_key=avengerang_first_outbound_hit）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion noncritical/noncopyable physical
--    damage step/detail、一个 entity_provider_mounts。
--    零 Q provider state / modifiers / listeners / matchers / repeats /
--    control / event / projectile / return / movement / reveal /
--    Dirty-Fighting stack 行；不创建/突变 P Dirty Fighting / basic 行。
-- 6. 保留且永不更新/删除/重建 provider_hero_akshan_basic_attack 与全部
--    Dirty Fighting / basic 图（dirty_fighting_stacks / proc / reset / emit）；
--    不要求/突变/合成/复制其它技能图。
-- 7. Q 无 ability-specific game-local type，不得新增 Q 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
-- 8. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 direction / range / extension / return pass /
-- homing / projectile travel / cooldown-start-after-return / sight / reveal /
-- movement speed / non-champion damage / spellshield 字段，故不编码这些表面，
-- 也不 claim 全保真）：
--   direction / range / extension；
--   return pass / homing / projectile travel；
--   cooldown start after return（真实 Wiki CD 时序；本 scaffold 用 ability 级
--     立即 CD，明确排除而非近似）；
--   sight / reveal / movement speed；
--   non-champion damage / spellshield；
--   ranks 1–4；Dirty Fighting stack coupling / basic mutation；
--   identity / panel attribute bootstrap（资源表仅 absent-only ensure）；
--   crit / on-hit；listener / state / event / modifier / repeat / control /
--   projectile / return / movement / reveal / Dirty-Fighting stack 行；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One selected-primary first-outbound physical hit, not full Q.
--
-- 数值来源（League Wiki Template:Data Akshan/Q → resolved
-- Template:Data Akshan/Avengerang；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Akshan/Q
--   resolved page Template:Data Akshan/Avengerang
--   wiki pageId 1502462
--   revision id 4007510
--   revision timestamp 2026-04-11T22:35:01Z
--   canonical raw byte size 2570
--   canonical content SHA256
--     1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/akshan-q.json
--     authoritative normalized bytes 2948 / SHA256
--     f6b0dd492d80c49a2259d366230f7d8f4c6d43a70688b42d0d0780e4866d9a1a
--   siblings：pages/akshan-q.json（authoritative sidecar/pages in Wasm repo）
--     pages bytes 688 / SHA256
--     11d2da87557737fed487fb106a9ffb7b4a6d7f1d32391ce3a5c142f9128509e0
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/akshan-q.wikitext 为
--     2570-byte materialization，SHA256
--     407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-5 selected primary-champion first outbound-hit single physical hit：
--     physical 165 + 70% bonus AD；mana 80；cooldown 5000ms。
--     源 wording：physical damage / (+ 70% bonus AD)；CD starts after return
--     （排除，不建模）。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   base0/resolved0/armor0 raw/final165；
--   base52/resolved52/armor0 raw/final165；
--   base52/resolved152/armor0 raw/final235；
--   same armor100 raw235/final117.5；
--   base52/resolved252/armor100 raw305/final152.5；
--   base0/resolved100 vs base52/resolved152 at armor0 both raw/final235
--     （bonusAD counterproof：equal bonus AD yields equal raw/final）；
--   mana240/baseAD52/resolvedAD152/targetHP1000/armor100 attempts
--     t0/t4999/t5000 -> success/cooldown skip/success；exactly two Q hits and
--     automatic starts；readyAt5000；final mana80/HP765；
--   mana79 t0 -> resource skip, unchanged mana/HP, no Q damage/start；
--   preserve provider_hero_akshan_basic_attack and all Dirty Fighting/basic
--     graphs without update/delete/recreate；Q seed contains zero Dirty
--     Fighting stack graph rows；
--   standalone provider：do not require/mutate/synthesize/copy other skill
--     graphs。
--
-- 前置：reserved_types_seed.sql；lol_generic_akshan_dirty_fighting_seed.sql
--       （hero_akshan + ad/mana 面板 EAV + basic/Dirty Fighting；无 mana 资源表行）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-akshan-avengerang-first-outbound-hit-phase-a-v2-20260726

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
    v_mana_attr          numeric;
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
    v_required_attrs     text[] := ARRAY['ad', 'mana'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_akshan_avengerang_first_outbound_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_akshan_avengerang_first_outbound_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_akshan_avengerang_first_outbound_hit_seed: missing reserved_type id(s): %',
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
            'lol_generic_akshan_avengerang_first_outbound_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- Dirty Fighting seed 显式前置：hero_akshan 身份（owns hero/panel/basic；
    -- 本 seed 不物化身份/面板属性；不以 ensure-entity legacy seeds 为理由物化）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_akshan'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_akshan_avengerang_first_outbound_hit_seed: missing game_entities hero_akshan (external Dirty Fighting / basic prerequisite; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_akshan'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_akshan_avengerang_first_outbound_hit_seed: missing entity_attribute_values hero_akshan/ad (external Dirty Fighting / basic prerequisite; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_akshan'
           AND eav.attr_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_akshan_avengerang_first_outbound_hit_seed: missing entity_attribute_values hero_akshan/mana (mana panel EAV; external Dirty Fighting / basic prerequisite; check-only)';
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    -- 本 seed 允许 ensure 的共享行之一；不物化身份/面板属性
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
    -- Frozen option A：仅缺席时 ensure mana 资源定义与实体资源值（派生自既有
    -- mana 面板 EAV）。ON CONFLICT DO NOTHING；永不 UPDATE/overwrite/delete
    -- 既有 resource definition/value。Dirty Fighting seed 无资源表行。
    -- =========================================================================

    SELECT eav.base_value
      INTO v_mana_attr
      FROM public.entity_attribute_values eav
     WHERE eav.game_id = v_game_id
       AND eav.entity_id = 'hero_akshan'
       AND eav.attr_key = 'mana';

    IF v_mana_attr IS NULL THEN
        RAISE EXCEPTION
            'lol_generic_akshan_avengerang_first_outbound_hit_seed: hero_akshan/mana base_value unavailable for resource derivation';
    END IF;


    -- =========================================================================
    -- hero_akshan Avengerang first outbound-hit（Q rank-5）：独立 provider +
    -- active impact 单次物理伤害（bonus AD）；standalone；不触碰 Dirty Fighting /
    -- basic；无 Q 专用 game-local type
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_akshan_q_avengerang_first_outbound_hit',
        20120,
        '艾克尚 Q 去而复还 Avengerang first outbound-hit（Phase-A v2 rank5 选定主冠军首段出站单次物理命中）',
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
            'provider_hero_akshan_q_avengerang_first_outbound_hit',
            'q_mana_cost',
            '{"op":"const","value":80}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_akshan_q_avengerang_first_outbound_hit',
            'q_cooldown_ms',
            '{"op":"const","value":5000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_akshan_q_avengerang_first_outbound_hit',
            'avengerang_first_outbound_hit_damage',
            '{"op":"add","args":[{"op":"const","value":165},{"op":"mul","args":[{"op":"const","value":0.70},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
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
        'ability_hero_akshan_q_avengerang_first_outbound_hit',
        'provider_hero_akshan_q_avengerang_first_outbound_hit',
        'avengerang_first_outbound_hit',
        20130,
        '去而复还（Q）',
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


    INSERT INTO public.ability_cooldowns (
        game_id, cooldown_id, ability_id, duration_formula_key,
        starts_on_phase_id, group_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cooldown_hero_akshan_q_avengerang_first_outbound_hit',
        'ability_hero_akshan_q_avengerang_first_outbound_hit',
        'q_cooldown_ms',
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

    -- null-duration impact phase：assembler 产出一次立即 operation（Phase-A scaffold）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_akshan_q_avengerang_first_outbound_hit_impact',
        'ability_hero_akshan_q_avengerang_first_outbound_hit',
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
        'sequence_hero_akshan_q_avengerang_first_outbound_hit_impact',
        'provider_hero_akshan_q_avengerang_first_outbound_hit',
        'avengerang_first_outbound_hit_impact',
        '去而复还 impact（选定主冠军首段出站单次物理命中）',
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
        'step_hero_akshan_q_avengerang_first_outbound_hit_damage',
        'sequence_hero_akshan_q_avengerang_first_outbound_hit_impact',
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
        'step_hero_akshan_q_avengerang_first_outbound_hit_damage',
        'avengerang_first_outbound_hit_damage',
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
        'phase_hero_akshan_q_avengerang_first_outbound_hit_impact',
        20260,
        'sequence_hero_akshan_q_avengerang_first_outbound_hit_impact',
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
        'hero_akshan',
        'provider_hero_akshan_q_avengerang_first_outbound_hit',
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
