-- =============================================================================
-- LoL generic Tristana Q Rapid Fire timed bonus attack-speed seed
-- （麦林炮手 Q 急速射击 Phase-A v1 自身限时攻速加成）
-- =============================================================================
--
-- 目标：在外部既有 hero_tristana / attack_speed / mana 数据已存在的前提下，挂载
--       独立 Q provider/active ability Rapid Fire timed bonus attack speed：
--       35 mana、16000ms CD、ability_started + source_owner +
--       ability/tristana_rapid_fire（62013）ALL listener 武装
--       rapid_fire_active=1（max1 / 7000ms / refresh_duration）；
--       listener.ability_id 必须为 NULL（Web 会把非空 ability_id 映射为
--       AbilityRef / castAbilityAt 子施法，不是事件过滤；若绑定同一 ability
--       则 R cast 的 ability_started 会误武装 Q——同 Xayah W isolation）。
--       AS percent_add = 1.20 * provider.state.rapid_fire_active。
--       规范投影为 timed provider-state self-buff（listener → 单一
--       state_change override）；零 damage / heal / shield / control / repeat /
--       explicit event step。
--
-- 候选：hero_skill|hero_tristana|Q|急速射击
-- task key：wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed
-- FROZEN_PLAN_REV=tristana-q-rapid-fire-timed-bonus-attack-speed-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_attack_speed_modifier
--   3. timed_state
--   4. ability_type_listener_isolation
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：
--        20100/20110/20120/20130/20160/20172/20173/20181/20190/20205/20212/20250；
--      - game_entities(lol,hero_tristana)；
--      - attribute_definitions(lol,attack_speed)；
--      - entity_attribute_values(lol,hero_tristana,attack_speed)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_tristana,mana)。
--    hero_tristana / attack_speed / mana 是 external existing-data / check-only
--    依赖；当前仓库没有任何 seed / materializer 物化 Tristana 身份 / 面板 /
--    attack_speed EAV / 资源行；本脚本亦不物化身份/面板/资源值。勿用 Batch-B
--    前置依赖、ensure-entity legacy seeds 或“本 seed 创建这些行”一类措辞描述该
--    实体；勿以 ensure-entity legacy seeds 为理由物化前置。
--    本 Q seed 不要求 R/Buster Shot / P/W/E/basic publication，亦不合成那些行；
--    与既有/未来 Tristana R（Buster Shot）并存且不突变、不依赖、不合成。
-- 4. 禁止写入：不对 attribute_definitions / resource_definitions / game_entities /
--    entity_attribute_values / entity_resource_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types，以及
--    fail-closed ensure game-local 62013 ability/tristana_rapid_fire
--    （reserved_type_id=NULL；双向 id↔key collision guards；同 Xayah W 62012 /
--    Hexplate 62010 ability-specific type 模式）与 type_relations → Q ability。
-- 5. 仅创建/挂载 provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed
--    （stable ID 族 hero_tristana_q_rapid_fire_timed_bonus_attack_speed）及其
--    隔离 Q 图：一个 provider、一个 active ability
--    （ability_key=rapid_fire_timed_bonus_attack_speed）、一个 cost、一个
--    cooldown、一个 timed provider state、一个 AS percent_add modifier、一个
--    listener（ability_id NULL）+ 恰好三 ALL matchers {20205,20212,62013}、
--    一个 sequence/step、一个 state_effect_details（override const1 /
--    state_scope/provider）、一个 type_relations、一个 entity_provider_mounts。
--    零 damage / heal / shield / control / repeat / explicit event /
--    ability_phases 行；不创建/突变 R/Buster Shot / P/W/E/basic 行。
-- 6. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- Ability-type listener isolation（必选；同 Xayah W）：
--   Web 把非空 provider_listeners.ability_id 映射为 ListenerDefinition.abilityRef，
--   runtime 会把已填充 AbilityRef 当作 castAbilityAt 子施法，而不是事件过滤。
--   因此本 seed 将 Q listener 的 ability_id 置为 NULL，并 fail-closed ensure
--   game-local 62013 ability/tristana_rapid_fire（reserved_type_id=NULL；双向
--   id↔key collision guards），写入 type_relations(lol,62013,'ability',
--   ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed,...)（在
--   listener matching 前物化），并为 ALL matcher 保留 20205 ability_started +
--   20212 source_owner 且新增 62013。不得把该 type 写入 ability_kind_type_id。
--
-- Normal non-refreshing truth（注释记录；不得把 runtime refresh_policy 本身
-- 描述为 non-refresh）：
--   CD 16000ms > duration 7000ms，故任何成功的 normal Q recast 都发生在窗
--   口到期之后；正常路径无法 refresh。明确排除：cooldown bypass / reset、
--   direct state admin、rank-up update。不 claim runtime policy 本身 non-refresh。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似）：
--   rank-up update；
--   attack animation / windup；
--   basic attack count / rotation；
--   cooldown bypass / reset / direct state admin；
--   damage / heal / shield / control / repeat / explicit event；
--   ranks 1–4；P / W / E / basic / Explosive Charge / loadout；
--   identity / panel / resource definition-or-value bootstrap；
--   Buster Shot dependency / synthesis（可并存，不依赖）；
--   live migration；自动 publish；E2E；live / full fidelity。
--
-- 数值来源（League Wiki Template:Data Tristana/Q → resolved
-- Template:Data Tristana/Rapid Fire；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Tristana/Q
--   resolved page Template:Data Tristana/Rapid Fire
--   wiki pageId 1308522
--   revision id 4026462
--   revision timestamp 2026-06-09T21:59:03Z
--   canonical raw byte size 872
--   canonical content SHA256
--     f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/tristana-q.json
--   siblings：pages/tristana-q.json（authoritative sidecar/pages in Wasm repo）
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/tristana-q.wikitext 为
--     866-byte materialization，SHA256
--     db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-5 self timed bonus attack speed：
--     AS +120%（percent_add 1.20 * rapid_fire_active）；持续 7000ms；
--     cost 35 mana；CD 16000ms。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   baseline AS0.60 → active AS1.32 at t0 through t6999 → baseline AS0.60 at t7000；
--   mana105 at t0/t15999/t16000 → success / cooldown skip / success；
--     exactly two Q ability_started；readyAt16000；final mana35 / active1 / AS1.32；
--   mana34 → resource skip，unchanged；
--   R cast must not arm Q or change AS（ability-type listener isolation）；
--   Q causes no R damage。
--   standalone provider：coexist with R/Buster Shot but no dependency/synthesis；
--     不要求 sibling publication。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_tristana + attack_speed 属性定义
--       与实体值 + mana 资源定义与实体资源值（check-only / external
--       existing-data；当前仓库无 materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-tristana-rapid-fire-timed-bonus-attack-speed-phase-a-v1-20260725

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_conflict_type_key  text;
    v_existing_name      text;
    v_existing_reserved  int;
    v_conflict_type_id   int;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20160, -- operation/state_change
        20172, -- value_policy/override
        20173, -- value_policy/percent_add
        20181, -- match_mode/all
        20190, -- refresh_policy/refresh_duration
        20205, -- event/ability_started
        20212, -- event/source_owner
        20250  -- state_scope/provider
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: game_id=% missing in public.games',
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
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: failed to lock game_data_state for %',
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
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_tristana（external existing-data；非本仓库物化；
    -- 非 Batch-B bootstrap claim；当前仓库无 materializer；不以 ensure-entity
    -- legacy seeds 为理由物化前置）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_tristana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: missing game_entities hero_tristana (external existing-data dependency; check-only; not materialized by a current repository seed)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'attack_speed'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: missing attribute_definitions for game_id=% attr_key=attack_speed (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_tristana'
           AND eav.attr_key = 'attack_speed'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: missing entity_attribute_values hero_tristana/attack_speed (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: missing resource_definitions mana (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_tristana'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: missing entity_resource_values hero_tristana/mana (external existing-data; check-only)';
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    -- 本 seed 允许 ensure 的共享行之一；不物化身份/面板/资源值
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
    -- game-local ability-specific type（reserved_type_id=NULL；同 Xayah W 62012 /
    -- Hexplate 62010）
    --   62013 ability/tristana_rapid_fire
    -- 仅作 type_relations ability tag + listener All-matcher；不得写入
    -- ability_kind_type_id；不得把 listener.ability_id 当作事件过滤。
    -- =========================================================================

    -- 62013 ability/tristana_rapid_fire
    -- 要求精确绑定：type_key=ability/tristana_rapid_fire 且 reserved_type_id=NULL；
    -- 错 key 或 reserved_type_id 非空均 fail-closed；正确既有行按 material-change
    -- 语义复用/校正描述。
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62013
       AND (
           t.type_key IS DISTINCT FROM 'ability/tristana_rapid_fire'
           OR t.reserved_type_id IS NOT NULL
       );

    IF FOUND THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: type_id=62013 already bound to type_key=% name=% reserved_type_id=% (expected ability/tristana_rapid_fire, reserved_type_id=NULL)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'ability/tristana_rapid_fire'
       AND t.type_id IS DISTINCT FROM 62013;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed: type_key=ability/tristana_rapid_fire already bound to type_id=% (expected 62013)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62013,
        'ability/tristana_rapid_fire',
        'Tristana Rapid Fire ability type',
        'Game-local ability type tag; Rapid Fire arm-listener All-matcher. Not ability_kind; not AbilityRef.',
        NULL,
        v_candidate,
        NOW()
    )
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
    -- hero_tristana Rapid Fire timed bonus AS（Q rank-5）：独立 provider + active
    -- ability_started + ability-type isolation listener 武装 timed state；AS
    -- percent_add；零 damage / ability_phases
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        20120,
        '麦林炮手 Q 急速射击 Rapid Fire timed bonus attack speed（Phase-A v1 rank5）',
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

    -- timed state：max1 / 7000ms / refresh_duration；不写 default_value（运行时缺省 0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        'rapid_fire_active',
        20100,
        1,
        7000,
        20190,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, provider_id, state_key) DO UPDATE SET
        value_type_id = EXCLUDED.value_type_id,
        max_value = EXCLUDED.max_value,
        duration_ms = EXCLUDED.duration_ms,
        refresh_policy_type_id = EXCLUDED.refresh_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_state_fields.value_type_id IS DISTINCT FROM EXCLUDED.value_type_id
       OR public.provider_state_fields.max_value IS DISTINCT FROM EXCLUDED.max_value
       OR public.provider_state_fields.duration_ms IS DISTINCT FROM EXCLUDED.duration_ms
       OR public.provider_state_fields.refresh_policy_type_id IS DISTINCT FROM EXCLUDED.refresh_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
            'q_mana_cost',
            '{"op":"const","value":35}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
            'q_cooldown_ms',
            '{"op":"const","value":16000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
            'rapid_fire_active_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
            'rapid_fire_attack_speed',
            '{"op":"mul","args":[{"op":"const","value":1.20},{"op":"read","path":"provider.state.rapid_fire_active"}]}'::jsonb,
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

    -- provider-bound attack_speed percent_add（可用性由公式内 rapid_fire_active 表达；condition NULL）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        'rapid_fire_attack_speed',
        NULL,
        20110,
        'attack_speed',
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        20173,
        'rapid_fire_attack_speed',
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, modifier_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        modifier_key = EXCLUDED.modifier_key,
        modifier_type_id = EXCLUDED.modifier_type_id,
        target_selector_type_id = EXCLUDED.target_selector_type_id,
        target_attr_key = EXCLUDED.target_attr_key,
        command_type_id = EXCLUDED.command_type_id,
        channel_type_id = EXCLUDED.channel_type_id,
        bucket_type_id = EXCLUDED.bucket_type_id,
        stage_type_id = EXCLUDED.stage_type_id,
        priority = EXCLUDED.priority,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        value_formula_key = EXCLUDED.value_formula_key,
        condition_formula_key = EXCLUDED.condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_modifiers.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.provider_modifiers.modifier_key IS DISTINCT FROM EXCLUDED.modifier_key
       OR public.provider_modifiers.modifier_type_id IS DISTINCT FROM EXCLUDED.modifier_type_id
       OR public.provider_modifiers.target_selector_type_id IS DISTINCT FROM EXCLUDED.target_selector_type_id
       OR public.provider_modifiers.target_attr_key IS DISTINCT FROM EXCLUDED.target_attr_key
       OR public.provider_modifiers.command_type_id IS DISTINCT FROM EXCLUDED.command_type_id
       OR public.provider_modifiers.channel_type_id IS DISTINCT FROM EXCLUDED.channel_type_id
       OR public.provider_modifiers.bucket_type_id IS DISTINCT FROM EXCLUDED.bucket_type_id
       OR public.provider_modifiers.stage_type_id IS DISTINCT FROM EXCLUDED.stage_type_id
       OR public.provider_modifiers.priority IS DISTINCT FROM EXCLUDED.priority
       OR public.provider_modifiers.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id
       OR public.provider_modifiers.value_formula_key IS DISTINCT FROM EXCLUDED.value_formula_key
       OR public.provider_modifiers.condition_formula_key IS DISTINCT FROM EXCLUDED.condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- active ability：成功 cast 由既有 runtime 发出 event/ability_started
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        'rapid_fire_timed_bonus_attack_speed',
        20130,
        '急速射击（Q）',
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

    -- 62013 ability/tristana_rapid_fire tag → Q ability（勿写入 ability_kind_type_id）
    -- 必须在 listener matching 前物化；参与 material-change-only revision。
    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62013,
        'ability',
        'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        '{"role":"rapid_fire"}'::jsonb,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, type_id, target_category, target_id) DO UPDATE SET
        extend = EXCLUDED.extend,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.type_relations.extend IS DISTINCT FROM EXCLUDED.extend;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_costs (
        game_id, cost_id, ability_id, phase_id, resource_key,
        amount_formula_key, allow_partial, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cost_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_mana',
        'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
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
        'cooldown_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
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

    -- deferred exactly-one-detail：state_change 配一 state_effect_details
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_arm',
        'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        'rapid_fire_arm',
        '急速射击武装',
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

    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_active_arm',
        'sequence_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_arm',
        0,
        20160,
        20110,
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

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_active_arm',
        20250,
        'rapid_fire_active',
        'rapid_fire_active_arm',
        20172,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        state_scope_type_id = EXCLUDED.state_scope_type_id,
        state_key = EXCLUDED.state_key,
        amount_formula_key = EXCLUDED.amount_formula_key,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.state_effect_details.state_scope_type_id IS DISTINCT FROM EXCLUDED.state_scope_type_id
       OR public.state_effect_details.state_key IS DISTINCT FROM EXCLUDED.state_key
       OR public.state_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.state_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- ability_started + source_owner + ability/tristana_rapid_fire(62013)
    -- → arm rapid_fire_active=1；ability_id 必须 NULL（非 AbilityRef / 非事件过滤）
    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started',
        'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
        'rapid_fire_on_ability_started',
        20205,
        NULL,
        1,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, listener_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        listener_key = EXCLUDED.listener_key,
        event_type_id = EXCLUDED.event_type_id,
        ability_id = EXCLUDED.ability_id,
        max_triggers_per_event = EXCLUDED.max_triggers_per_event,
        chain_limit_key = EXCLUDED.chain_limit_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_listeners.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.provider_listeners.listener_key IS DISTINCT FROM EXCLUDED.listener_key
       OR public.provider_listeners.event_type_id IS DISTINCT FROM EXCLUDED.event_type_id
       OR public.provider_listeners.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.provider_listeners.max_triggers_per_event IS DISTINCT FROM EXCLUDED.max_triggers_per_event
       OR public.provider_listeners.chain_limit_key IS DISTINCT FROM EXCLUDED.chain_limit_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Arm All: ability_started / ability/tristana_rapid_fire / source_owner
    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started', 20181, 20205, v_candidate, NOW()),
        (v_game_id, 'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started', 20181, 20212, v_candidate, NOW()),
        (v_game_id, 'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started', 20181, 62013, v_candidate, NOW())
    ON CONFLICT (game_id, listener_id, match_mode_type_id, type_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.listener_match_types.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.listener_effect_sequences (
        game_id, listener_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started',
        'sequence_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_arm',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, listener_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.listener_effect_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_provider_mounts (
        game_id, entity_id, provider_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_tristana',
        'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',
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
