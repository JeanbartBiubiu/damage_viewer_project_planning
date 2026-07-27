-- =============================================================================
-- LoL generic Azir Q Conquering Sands one-soldier selected-primary hit seed
-- （沙皇 Q 狂沙猛攻 Phase-A v1 假定一枚既有沙兵选定主目标单次魔法命中）
-- =============================================================================
--
-- 目标：在外部既有 hero_azir / ap / mana 数据已存在的前提下，挂载独立 Q
--       provider/active ability Conquering Sands one-soldier selected-primary
--       hit：110 mana、6000ms listed CD scaffold、impact 对 opponent（champion）
--       恰好一次 magic damage =
--       140 + 0.55 * source.attr.ap.resolved。
--       AP 为 source.attr.ap.resolved 直接读取，不得发明其它 AP 语义；
--       无关 AD / crit / crit_damage 变化不得改变 Q 伤害。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate selected-primary magic hit 为
--       Phase-A scaffold，不是实际 soldier entity / spawn / command / path /
--       dash / collision / geometry / multitarget / slow / full-Q fidelity。
--       「假定恰好一枚既有沙兵」仅为 caller/scenario assumption 与 completed-
--       boundary exclusion；本脚本不建模、不 enforce 沙兵状态 / cast-precondition
--       gate（非 modeled/enforced soldier-state precondition）。
--       伤害公式必须为嵌套二元算术树（每个算术节点恰好二元；AP path 恰好一次）：
--         add(const 140, mul(const 0.55, read source.attr.ap.resolved))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step；无 Azir-Q-specific type。
--
-- 候选：hero_skill|hero_azir|Q|狂沙猛攻
-- task key：wasm-generic-azir-conquering-sands-one-soldier-selected-primary-hit
-- FROZEN_PLAN_REV=azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank5_assume_one_existing_sand_soldier_selected_primary_single_magic_hit; immediate_impact_scaffold; magic_140_plus_0_55_ap; mana110_listed_cooldown6000ms_scaffold; no_soldier_entity_spawn_count_formation_command_path_target_location_dash_collision_geometry_multitarget_slow_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_magic_damage
--   3. ap_ratio
--   4. one_existing_soldier_selected_primary_hit_scaffold
--
-- 契约要点：
-- 0. 显式不含 salvage tags。Raw meta_or_non_target_dps 为 legacy provenance，永非
--    governed tag（不得列入 Ordered tags）。
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20221/20260；
--      - game_entities(lol,hero_azir)；
--      - attribute_definitions(lol,ap)；
--      - entity_attribute_values(lol,hero_azir,ap)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_azir,mana)。
--    hero_azir / ap / mana 是 external existing-data / check-only 依赖；
--    当前仓库没有任何 seed / materializer 物化 Azir 身份 / 面板 / ap EAV /
--    资源行；本脚本亦不物化身份/面板/资源值。勿用 Batch-B 前置依赖、sibling
--    provider、ensure-entity legacy seeds 或“本 seed 创建这些行”一类措辞描述该
--    实体；勿以 ensure-entity legacy seeds 为理由物化前置。
--    本 seed 非自包含；未来执行/发布前须外部供给 hero_azir + AP + mana 数据
--    （publication/live prerequisite limitation，非本脚本物化许可）。
--    本 Q seed 不要求/突变/合成/复制 P/W/E/R/basic 或任何 soldier provider；
--    仅挂载独立 Q。
-- 4. 禁止写入：不对 attribute_definitions / resource_definitions / game_entities /
--    entity_attribute_values / entity_resource_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：magic damage type `20221`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
--    reserved type comments/checks include
--    `20111/20120/20130/20142/20150/20170/20221/20260`；explicitly forbid
--    `20230`（本仓库 20230 为 provider_action/apply，不得误用作 true damage）。
-- 5. 仅创建/挂载 provider_hero_azir_q_conquering_sands_one_soldier_primary_hit
--    （stable ID 族 hero_azir_q_conquering_sands_one_soldier_primary_hit）及其隔离 Q 图：
--    一个 provider、一个 active ability（ability_key=conquering_sands_one_soldier_primary_hit）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion noncritical/noncopyable magic
--    damage step/detail、一个 entity_provider_mounts。
--    crit_eligible=false；copyable_on_hit=false。
--    零 Azir Q provider state / modifiers / listeners / matchers / repeats /
--    tick / control / scheduler / projectile / soldier / slow / movement 行；
--    不创建/突变/合成/复制 P/W/E/R/basic 或任何 soldier provider 行。
-- 6. Q 无 ability-specific game-local type，不得新增 Q 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 soldier entity / spawn / despawn / count /
-- formation / placement / attack state / cast-precondition enforcement /
-- command / path / dash / travel / collision / Wind Wall / Rebuttal /
-- target location / range / geometry / pass-through / arrival / multiple
-- enemies / slow / duration / refresh 字段，故不编码这些表面，也不 claim 全保真）：
--   ranks 1–4；
--   soldier entity / spawn / despawn / count / formation / placement / attack state；
--   cast-precondition enforcement（Wiki「需要已召唤沙兵」仅注释证据；不建模 gate）；
--   command / path / dash / travel / collision / Wind Wall / Rebuttal；
--   target location / range / geometry / pass-through / arrival / multiple enemies；
--   slow / duration / refresh；
--   P / W / E / R / basic / items / loadout；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / tick / control / scheduler /
--   projectile / soldier / slow / movement / sibling detail；
--   live migration；自动 publish；E2E；live / Admin / Web / Wasm / asset /
--   full-game / full-Q fidelity。
--   One assume-one-existing-soldier selected-primary single magic hit, not full Q.
--
-- 数值来源（League Wiki Template:Data Azir/Q → resolved
-- Template:Data Azir/Conquering Sands；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Azir/Q
--   resolved page Template:Data Azir/Conquering Sands
--   wiki pageId 1306850
--   revision id 4024967
--   revision timestamp 2026-06-04T07:26:59Z
--   canonical raw byte size 2512
--   canonical content SHA256
--     168e2568c6795859e68831eb23b59b62d249aceb07cf3740403b1616516b51f2
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/azir-q.json
--     authoritative normalized bytes 3119 / SHA256
--     9e2cfc28ced422699bbb40722ba46d82167c79f34bbd696f2fc4080e52120fb7
--   siblings：pages/azir-q.json（authoritative sidecar/pages in Wasm repo）
--     pages bytes 684 / SHA256
--     a15a3c54079cd8a75584c9725bb792441103ff27cafa31fa136d076791fa71f4
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/azir-q.wikitext 为
--     2510-byte materialization，SHA256
--     6885ead987cae40fa37992d170337007629e3f12ebfc494eb3a1f54b5fb110e4。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   Wiki：Q requires a summoned soldier；subsequent soldiers add no damage/slow。
--   Phase-A assumes one existing soldier without modeling the gate。
--   rank-5 selected-primary single magic hit：
--     magic 140 + 55% AP；mana 110；cooldown 6s（6000ms listed scaffold）。
--     源 wording：magic damage / (+ 55% AP)。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime；测试夹具可创建外部前置行，生产 seed 不得）：
--   AP0/MR0 raw/final140；
--   AP100/MR100 raw195/final97.5；
--   unrelated AD/crit/crit_damage variation leaves output unchanged；
--   AP100, target HP1000/MR100, mana330, attempts t0/t5999/t6000:
--     success/skip/success；exactly two Q damage items and two automatic
--     ability_started；final mana110/HP805；ready-at6000 / readyAt6000；
--   mana109 at t0: resource skip, mana/HP unchanged, no Q damage/start。
--   Prove idempotence/no-op rerun and no sibling/provider mutation
--     （注释契约；standalone provider：preserve existing P/W/E/R/basic/soldier
--     without requiring, mutating, synthesizing or copying them）。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_azir + ap 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；当前仓库
--       无 Azir materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-azir-conquering-sands-one-soldier-primary-hit-phase-a-v1-20260727

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_required_reserved  int[] := ARRAY[
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20170, -- value_policy/add
        20221, -- damage/magic
        20260  -- phase_trigger/on_enter
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_azir（external existing-data；非本仓库物化；
    -- 非 Batch-B bootstrap claim；当前仓库无 Azir materializer；不以 ensure-entity
    -- legacy seeds 为理由物化前置）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_azir'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed: missing game_entities hero_azir (external existing-data dependency; check-only; not materialized by a current repository seed)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed: missing attribute_definitions for game_id=% attr_key=ap (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_azir'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed: missing entity_attribute_values hero_azir/ap (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed: missing resource_definitions mana (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_azir'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed: missing entity_resource_values hero_azir/mana (external existing-data; check-only)';
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    -- 本 seed 唯一允许 ensure 的共享行；不物化身份/面板/资源值
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
    -- hero_azir Conquering Sands one-soldier selected-primary hit（Q rank-5）：
    -- 独立 provider + active impact 单次魔法伤害（AP resolved）；standalone；
    -- 不触碰 P/W/E/R/basic/soldier；假定一枚既有沙兵仅为 scenario assumption
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit',
        20120,
        '沙皇 Q 狂沙猛攻 Conquering Sands one-soldier selected-primary hit（Phase-A v1 rank5 假定一枚既有沙兵选定主目标单次魔法命中）',
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
            'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit',
            'q_mana_cost',
            '{"op":"const","value":110}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit',
            'q_cooldown_ms',
            '{"op":"const","value":6000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit',
            'conquering_sands_one_soldier_primary_hit_damage',
            '{"op":"add","args":[{"op":"const","value":140},{"op":"mul","args":[{"op":"const","value":0.55},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_azir_q_conquering_sands_one_soldier_primary_hit',
        'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit',
        'conquering_sands_one_soldier_primary_hit',
        20130,
        '狂沙猛攻（Q）',
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
        'cost_hero_azir_q_conquering_sands_one_soldier_primary_hit_mana',
        'ability_hero_azir_q_conquering_sands_one_soldier_primary_hit',
        NULL,
        'mana',
        'q_mana_cost',
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
        'cooldown_hero_azir_q_conquering_sands_one_soldier_primary_hit',
        'ability_hero_azir_q_conquering_sands_one_soldier_primary_hit',
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
        'phase_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact',
        'ability_hero_azir_q_conquering_sands_one_soldier_primary_hit',
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
        'sequence_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact',
        'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit',
        'conquering_sands_one_soldier_primary_hit_impact',
        '狂沙猛攻 impact（假定一枚既有沙兵选定主目标单次魔法命中）',
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
        'step_hero_azir_q_conquering_sands_one_soldier_primary_hit_damage',
        'sequence_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact',
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
        'step_hero_azir_q_conquering_sands_one_soldier_primary_hit_damage',
        'conquering_sands_one_soldier_primary_hit_damage',
        20221,
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
        'phase_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact',
        20260,
        'sequence_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact',
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
        'hero_azir',
        'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit',
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
