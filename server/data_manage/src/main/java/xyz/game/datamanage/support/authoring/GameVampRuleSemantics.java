package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import xyz.game.datamanage.model.gamevamp.GameVampRule;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampOverride;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampQualification;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampType;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 游戏吸血规则及伤害资格的最终状态检查；不执行伤害或公式。 */
public final class GameVampRuleSemantics {
    private final JdbcTemplate jdbc;

    public GameVampRuleSemantics(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void validate(String gameId, List<Aggregate> aggregates) {
        List<GameVampRule> rules = readRules(jdbc, gameId);
        Map<String, String> attributes = attributeTypes(jdbc, gameId);
        Set<String> categories = new HashSet<>(jdbc.queryForList(CATEGORIES_SQL, String.class, gameId));
        Map<String, Set<String>> skillCategories = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(SKILL_CATEGORIES_SQL, gameId)) {
            skillCategories.computeIfAbsent((String) row.get("skill_key"), ignored -> new HashSet<>())
                .add((String) row.get("skill_category_key"));
        }
        validateFinal(rules, attributes, categories, skillCategories, aggregates);
    }

    public static void validateFinal(List<GameVampRule> rules, Map<String, String> attributes,
                                     Set<String> categories, Map<String, Set<String>> skillCategories,
                                     List<Aggregate> aggregates) {
        List<Map<String, String>> issues = new ArrayList<>();
        validateRules(rules, attributes, categories, issues);
        Set<SkillEffectVampType> types = new HashSet<>();
        for (GameVampRule rule : rules) if (rule != null) types.add(rule.vampType());
        for (Aggregate aggregate : aggregates) {
            if (aggregate.type() != SourceType.EFFECT) continue;
            int i = 0;
            for (JsonNode result : aggregate.data().path("results")) {
                String path = "results[" + i++ + "].detail";
                if (!"DAMAGE".equals(result.path("resultType").asText())) continue;
                List<Map<String, String>> resultIssues = new ArrayList<>();
                SkillEffectDamageDetail detail;
                try {
                    detail = AggregateJson.read(result.path("detail").toString(), SkillEffectDamageDetail.class);
                } catch (RuntimeException ex) {
                    resultIssues.add(issue(path, "INVALID_VAMP_DETAIL", "伤害吸血明细不合法"));
                    appendSource(issues, resultIssues, aggregate);
                    continue;
                }
                if (detail == null) {
                    resultIssues.add(issue(path, "REQUIRED", "伤害明细不能为空"));
                    appendSource(issues, resultIssues, aggregate);
                    continue;
                }
                validateDamageShape(detail, path, resultIssues);
                if (detail.unknownFields().contains("vampRules")) {
                    resultIssues.add(issue(path + ".vampRules", "UNKNOWN_FIELD", "旧吸血规则字段不再接受"));
                }
                if (detail.vampQualification() == SkillEffectVampQualification.RESOLVED) {
                    if (rules.isEmpty()) resultIssues.add(issue(path + ".vampQualification",
                        "GAME_VAMP_RULE_REQUIRED", "已核定伤害至少需要一项游戏吸血规则"));
                    if (detail.deliveryKind() == null || detail.originKind() == null) {
                        resultIssues.add(issue(path, "DAMAGE_CLASSIFICATION_REQUIRED", "已核定伤害必须提供产生方式和来源性质"));
                    }
                    if (skillCategories.getOrDefault(aggregate.skillKey(), Set.of()).isEmpty()) {
                        resultIssues.add(issue(path + ".vampQualification", "SKILL_CATEGORY_REQUIRED", "已核定伤害的技能必须具有基础分类"));
                    }
                }
                if (detail.vampOverrides() != null) {
                    for (int v = 0; v < detail.vampOverrides().size(); v++) {
                        SkillEffectVampOverride override = detail.vampOverrides().get(v);
                        if (override != null && override.vampType() != null && !types.contains(override.vampType())) {
                            resultIssues.add(issue(path + ".vampOverrides[" + v + "].vampType",
                                "GAME_VAMP_RULE_REQUIRED", "吸血例外必须引用已配置的同游戏吸血规则"));
                        }
                    }
                }
                appendSource(issues, resultIssues, aggregate);
            }
        }
        validatePriorHealingOutputs(aggregates, issues);
        if (!issues.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "409.GAME_VAMP_RULE_INVALID",
            "游戏吸血规则或伤害资格的最终配置不合法", Map.of("fieldIssues", issues));
    }

    public static void validateRules(List<GameVampRule> rules, Map<String, String> attributes,
                                    Set<String> categories, List<Map<String, String>> issues) {
        if (rules == null) { issues.add(issue("rules", "REQUIRED", "吸血规则集合不能为空")); return; }
        Set<SkillEffectVampType> seen = new HashSet<>();
        for (int i = 0; i < rules.size(); i++) {
            String path = "rules[" + i + "]";
            GameVampRule rule = rules.get(i);
            if (rule == null) { issues.add(issue(path, "REQUIRED", "吸血规则不能为空")); continue; }
            if (rule.vampType() == null) issues.add(issue(path + ".vampType", "REQUIRED", "吸血类型不能为空"));
            else if (!seen.add(rule.vampType())) issues.add(issue(path + ".vampType", "DUPLICATE_VAMP_TYPE", "同一吸血类型不能重复"));
            if (rule.sourceAttributeKey() == null || !"DECIMAL".equals(attributes.get(rule.sourceAttributeKey()))) {
                issues.add(issue(path + ".sourceAttributeKey", "INVALID_SOURCE_ATTRIBUTE", "来源比例属性必须是同游戏已有的十进制属性"));
            }
            if (rule.basisOutputKind() == null) issues.add(issue(path + ".basisOutputKind", "REQUIRED", "计算基数不能为空"));
            if (rule.defaultEfficiency() == null || rule.defaultEfficiency().signum() < 0
                || !Double.isFinite(rule.defaultEfficiency().doubleValue())) {
                issues.add(issue(path + ".defaultEfficiency", "RANGE_INVALID", "默认效率必须为有限非负数"));
            }
            validateSet(rule.deliveryKinds(), path + ".deliveryKinds", issues);
            validateSet(rule.originKinds(), path + ".originKinds", issues);
            validateSet(rule.skillCategoryKeys(), path + ".skillCategoryKeys", issues);
            if (rule.skillCategoryKeys() != null) for (int c = 0; c < rule.skillCategoryKeys().size(); c++) {
                if (rule.skillCategoryKeys().get(c) == null || !categories.contains(rule.skillCategoryKeys().get(c))) {
                    issues.add(issue(path + ".skillCategoryKeys[" + c + "]", "INVALID_SKILL_CATEGORY", "技能分类必须属于当前游戏且真实存在"));
                }
            }
        }
    }

    public static void validateDamageShape(SkillEffectDamageDetail detail, String path,
                                           List<Map<String, String>> issues) {
        if (detail.vampQualification() == null) issues.add(issue(path + ".vampQualification", "REQUIRED", "吸血资格状态不能为空"));
        if (detail.vampOverrides() == null) { issues.add(issue(path + ".vampOverrides", "REQUIRED", "吸血例外集合不能为空")); return; }
        if (detail.vampQualification() == SkillEffectVampQualification.UNRESOLVED && !detail.vampOverrides().isEmpty()) {
            issues.add(issue(path + ".vampOverrides", "UNRESOLVED_REQUIRES_EMPTY", "未核定伤害不能保存吸血例外"));
        }
        Set<SkillEffectVampType> seen = new HashSet<>();
        for (int i = 0; i < detail.vampOverrides().size(); i++) {
            String p = path + ".vampOverrides[" + i + "]";
            SkillEffectVampOverride override = detail.vampOverrides().get(i);
            if (override == null) { issues.add(issue(p, "REQUIRED", "吸血例外不能为空")); continue; }
            if (override.vampType() == null) issues.add(issue(p + ".vampType", "REQUIRED", "吸血种类不能为空"));
            else if (!seen.add(override.vampType())) issues.add(issue(p + ".vampType", "DUPLICATE_VAMP_TYPE", "同一吸血种类不能重复"));
            if (override.mode() == null) issues.add(issue(p + ".mode", "REQUIRED", "吸血例外方式不能为空"));
            else if (override.mode() == SkillEffectVampOverrideMode.DISABLED) {
                if (override.basisOutputKind() != null) issues.add(issue(p + ".basisOutputKind", "FIELD_MUTEX", "禁止吸血时不能配置计算基数"));
                if (override.efficiencyValue() != null) issues.add(issue(p + ".efficiencyValue", "FIELD_MUTEX", "禁止吸血时不能配置效率"));
            } else {
                if (override.basisOutputKind() == null) issues.add(issue(p + ".basisOutputKind", "INVALID_VAMP_BASIS", "覆盖吸血时计算基数必填"));
                if (override.efficiencyValue() == null) issues.add(issue(p + ".efficiencyValue", "REQUIRED", "覆盖吸血时效率必填"));
                else if (override.efficiencyValue().kind() == SkillNumericValue.Kind.FIXED
                    && (override.efficiencyValue().value().signum() < 0 || !Double.isFinite(override.efficiencyValue().value().doubleValue()))) {
                    issues.add(issue(p + ".efficiencyValue", "RANGE_INVALID", "吸血效率必须是有限非负数"));
                }
            }
        }
    }

    private static void validateSet(List<?> values, String path, List<Map<String, String>> issues) {
        if (values == null || values.isEmpty()) { issues.add(issue(path, "REQUIRED", "适用集合不能为空")); return; }
        Set<Object> seen = new HashSet<>();
        for (int i = 0; i < values.size(); i++) {
            if (values.get(i) == null || !seen.add(values.get(i))) issues.add(issue(path + "[" + i + "]", "INVALID_SET", "适用集合不允许空值或重复值"));
        }
    }

    private static void validatePriorHealingOutputs(List<Aggregate> aggregates, List<Map<String, String>> issues) {
        Map<String, Aggregate> effects = new LinkedHashMap<>();
        for (Aggregate a : aggregates) if (a.type() == SourceType.EFFECT) effects.put(a.skillKey() + "/" + a.key(), a);
        for (Aggregate a : aggregates) {
            if (a.type() != SourceType.TRIGGER) continue;
            Map<String, JsonNode> actions = new LinkedHashMap<>();
            for (JsonNode action : a.data().path("actions")) actions.put(action.path("actionKey").asText(), action);
            int actionIndex = 0;
            for (JsonNode action : a.data().path("actions")) {
                int bindingIndex = 0;
                for (JsonNode binding : action.path("runtimeInputBindings")) {
                    String path = "actions[" + actionIndex + "].runtimeInputBindings[" + bindingIndex++ + "].detail.outputKind";
                    JsonNode detail = binding.path("detail");
                    if (!"PRIOR_ACTION_RESULT".equals(binding.path("sourceType").asText())
                        || !"ACTUAL_HEALING".equals(detail.path("outputKind").asText())) continue;
                    JsonNode sourceAction = actions.get(detail.path("sourceActionKey").asText());
                    if (sourceAction == null) continue; // 通用引用检查处理缺失对象。
                    Aggregate effect = effects.get(a.skillKey() + "/" + sourceAction.path("detail").path("effectKey").asText());
                    if (effect == null) continue;
                    for (JsonNode result : effect.data().path("results")) {
                        if (result.path("resultKey").asText().equals(detail.path("sourceResultKey").asText())
                            && "DAMAGE".equals(result.path("resultType").asText())
                            && !"RESOLVED".equals(result.path("detail").path("vampQualification").asText())) {
                            appendSource(issues, List.of(issue(path, "PRIOR_HEALING_NOT_AVAILABLE", "未核定伤害不提供前序吸血治疗输出")), a);
                        }
                    }
                }
                actionIndex++;
            }
        }
    }

    private static void appendSource(List<Map<String, String>> target, List<Map<String, String>> issues, Aggregate a) {
        for (Map<String, String> issue : issues) {
            Map<String, String> item = new LinkedHashMap<>(issue);
            item.put("sourceSkillKey", a.skillKey()); item.put("sourceType", a.type().name()); item.put("sourceKey", a.key());
            target.add(item);
        }
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    public static List<GameVampRule> readRules(JdbcTemplate jdbc, String gameId) {
        return jdbc.queryForList(RULES_SQL, String.class, gameId).stream()
            .map(json -> AggregateJson.read(json, GameVampRule.class)).toList();
    }

    public static Map<String, String> attributeTypes(JdbcTemplate jdbc, String gameId) {
        Map<String, String> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(ATTRIBUTES_SQL, gameId)) {
            result.put((String) row.get("attribute_key"), (String) row.get("value_type"));
        }
        return result;
    }

    public static final String RULES_SQL = """
        SELECT jsonb_build_object('vampType', vamp_type, 'sourceAttributeKey', source_attribute_key,
            'basisOutputKind', basis_output_kind, 'defaultEfficiency', default_efficiency,
            'deliveryKinds', delivery_kinds, 'originKinds', origin_kinds,
            'skillCategoryKeys', skill_category_keys)::text
          FROM public.game_vamp_rules WHERE game_id = ?
         ORDER BY CASE vamp_type WHEN 'LIFE_STEAL' THEN 0 WHEN 'OMNIVAMP' THEN 1
                  WHEN 'PHYSICAL_VAMP' THEN 2 WHEN 'SPELL_VAMP' THEN 3 END
        """;
    public static final String ATTRIBUTES_SQL = "SELECT attribute_key, value_type FROM public.attributes WHERE game_id = ?";
    public static final String CATEGORIES_SQL = "SELECT skill_category_key FROM public.skill_categories WHERE game_id = ?";
    public static final String SKILL_CATEGORIES_SQL = "SELECT skill_key, skill_category_key FROM public.skill_category_relations WHERE game_id = ?";
}
