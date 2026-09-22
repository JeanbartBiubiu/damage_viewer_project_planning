-- 通用吸血规则一次性结构迁移。调用方管理单事务，脚本不提交。
-- 执行前必须在同一连接创建 pg_temp.vamp_migration_archive，结构及完整行值与
-- public.skill_effects 一致，仅含至少一条 DAMAGE 的效果；并将全部原行冻结到外部档案。
-- 调用方必须先比对数据库目标、外部完整前值摘要及脚本摘要；不能直接独立执行此脚本。
-- 不自动建立任何游戏规则，不自动核定旧伤害。重复运行明确失败。
LOCK TABLE public.games, public.attributes, public.skill_categories,
    public.skill_effects, public.skill_trigger_rules, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;

DO $check$
DECLARE dependency_path text;
BEGIN
    IF to_regclass('public.game_vamp_rules') IS NOT NULL THEN
        RAISE EXCEPTION '游戏吸血规则表已存在，禁止重放迁移';
    END IF;
    IF to_regclass('pg_temp.vamp_migration_archive') IS NULL THEN
        RAISE EXCEPTION '缺少已冻结的完整效果前值档案';
    END IF;
    IF EXISTS (
        (SELECT * FROM public.skill_effects e WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements(e.results) r WHERE r->>'resultType' = 'DAMAGE')
         EXCEPT SELECT * FROM pg_temp.vamp_migration_archive)
        UNION ALL
        (SELECT * FROM pg_temp.vamp_migration_archive
         EXCEPT SELECT * FROM public.skill_effects e WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements(e.results) r WHERE r->>'resultType' = 'DAMAGE'))
    ) THEN RAISE EXCEPTION '完整效果前值与冻结档案不一致'; END IF;
    IF EXISTS (SELECT 1 FROM public.skill_effects e CROSS JOIN LATERAL jsonb_array_elements(e.results) r
        WHERE r->>'resultType' = 'DAMAGE' AND
          (jsonb_typeof(r->'detail') IS DISTINCT FROM 'object'
           OR jsonb_typeof(r->'detail'->'vampRules') IS DISTINCT FROM 'array'
           OR r->'detail' ? 'vampQualification' OR r->'detail' ? 'vampOverrides')) THEN
        RAISE EXCEPTION '旧伤害形状缺失或混用新字段，停止迁移';
    END IF;
    SELECT t.game_id || '/' || t.skill_key || '/rules/' || t.rule_key || '/actions/' || (a->>'actionKey')
           || '/runtimeInputBindings/' || (b->>'bindingKey')
      INTO dependency_path
      FROM public.skill_trigger_rules t
      CROSS JOIN LATERAL jsonb_array_elements(t.actions) a
      CROSS JOIN LATERAL jsonb_array_elements(a->'runtimeInputBindings') b
      JOIN public.skill_effects e ON e.game_id=t.game_id AND e.skill_key=t.skill_key
       AND e.effect_key=(SELECT sa->'detail'->>'effectKey' FROM jsonb_array_elements(t.actions) sa
                         WHERE sa->>'actionKey'=b->'detail'->>'sourceActionKey')
      CROSS JOIN LATERAL jsonb_array_elements(e.results) r
     WHERE b->>'sourceType'='PRIOR_ACTION_RESULT' AND b->'detail'->>'outputKind'='ACTUAL_HEALING'
       AND r->>'resultKey'=b->'detail'->>'sourceResultKey' AND r->>'resultType'='DAMAGE'
     ORDER BY t.game_id,t.skill_key,t.rule_key,a->>'actionKey',b->>'bindingKey' LIMIT 1;
    IF dependency_path IS NOT NULL THEN
        RAISE EXCEPTION '伤害转为未核定会使前序吸血治疗输出失效，须先逐项裁定: %', dependency_path;
    END IF;
END
$check$;

CREATE TABLE public.game_vamp_rules (
    game_id varchar(64) NOT NULL,
    vamp_type varchar(32) NOT NULL,
    source_attribute_key varchar(64) NOT NULL,
    basis_output_kind varchar(32) NOT NULL,
    default_efficiency numeric NOT NULL,
    delivery_kinds jsonb NOT NULL,
    origin_kinds jsonb NOT NULL,
    skill_category_keys jsonb NOT NULL,
    CONSTRAINT pk_game_vamp_rules PRIMARY KEY (game_id, vamp_type),
    CONSTRAINT fk_game_vamp_rules_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT fk_game_vamp_rules_attribute FOREIGN KEY (game_id, source_attribute_key)
        REFERENCES public.attributes (game_id, attribute_key),
    CONSTRAINT ck_game_vamp_rules_type CHECK (vamp_type IN ('LIFE_STEAL', 'OMNIVAMP', 'PHYSICAL_VAMP', 'SPELL_VAMP')),
    CONSTRAINT ck_game_vamp_rules_basis CHECK (basis_output_kind IN ('POST_DEFENSE_DAMAGE', 'ACTUAL_HP_LOSS')),
    CONSTRAINT ck_game_vamp_rules_efficiency CHECK (default_efficiency >= 0 AND default_efficiency < 'Infinity'::numeric),
    CONSTRAINT ck_game_vamp_rules_delivery CHECK (jsonb_typeof(delivery_kinds) = 'array' AND jsonb_array_length(delivery_kinds) > 0
        AND delivery_kinds <@ '["SKILL", "BASIC_ATTACK"]'::jsonb),
    CONSTRAINT ck_game_vamp_rules_origin CHECK (jsonb_typeof(origin_kinds) = 'array' AND jsonb_array_length(origin_kinds) > 0
        AND origin_kinds <@ '["DIRECT", "REFLECTED"]'::jsonb),
    CONSTRAINT ck_game_vamp_rules_categories CHECK (jsonb_typeof(skill_category_keys) = 'array' AND jsonb_array_length(skill_category_keys) > 0)
);

COMMENT ON TABLE public.game_vamp_rules IS '游戏通用吸血规则；集合去重、分类引用和比例属性类型由同游戏事务最终校验';
COMMENT ON COLUMN public.game_vamp_rules.default_efficiency IS '非负有限倍率，1表示100%；不代替来源对象的实时吸血比例';
COMMENT ON COLUMN public.game_vamp_rules.skill_category_keys IS '同游戏适用技能分类，集合内任一匹配，与产生方式、来源性质同时满足';

-- 在完整旧行已归档且依赖检查通过后，所有旧伤害仅转换为未核定空例外。
-- 保留原结果顺序、非伤害结果、其他伤害字段、生命周期及元数据时间戳。
UPDATE public.skill_effects e
   SET results = (SELECT jsonb_agg(
       CASE WHEN r->>'resultType' = 'DAMAGE' THEN
           jsonb_set(r, '{detail}', ((r->'detail') - 'vampRules')
               || '{"vampQualification":"UNRESOLVED","vampOverrides":[]}'::jsonb)
       ELSE r END ORDER BY ordinal)
       FROM jsonb_array_elements(e.results) WITH ORDINALITY AS expanded(r, ordinal))
 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(e.results) r WHERE r->>'resultType' = 'DAMAGE');

-- 旧效率引用不再属于新业务对象；其他引用逐字保留。完整旧结果仍在冻结档案中。
DELETE FROM public.skill_object_references
 WHERE source_type = 'EFFECT' AND field_path ~ '^results\[[0-9]+\]\.detail\.vampRules\[[0-9]+\]\.efficiencyValue\.(formulaKey|parameterKey)$';

-- 提交前调用方运行 GameConfigurationWriteGuard 的同事务最终校验和引用重建，
-- 验证全量新结果等于上述确定转换、非目标数据未变，再由独立连接读回已提交结构与数据。
