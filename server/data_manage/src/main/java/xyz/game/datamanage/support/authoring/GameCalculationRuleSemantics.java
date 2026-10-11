package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import xyz.game.datamanage.support.formula.FormulaContractValidator;

/** 游戏用途和派生定义的独立校验；不伪装为技能引用索引，不执行共同算术。 */
public final class GameCalculationRuleSemantics {
    public static final String RULES_SQL = "SELECT configuration::text FROM public.game_calculation_rules WHERE game_id = ?";
    public static final String ATTRIBUTES_SQL = "SELECT attribute_key, value_type, status FROM public.attributes WHERE game_id = ? ORDER BY attribute_key";
    public static final String CATEGORIES_SQL = "SELECT skill_category_key, status FROM public.skill_categories WHERE game_id = ? ORDER BY skill_category_key";
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final List<String> CONFIG_FIELDS = List.of("criticalChanceAttributeKey", "criticalMultiplierMin",
        "attackSpeedAttributeKey", "attributeDerivations", "basicAttackCategoryKey", "equipmentPassiveCategoryKey", "ignorableCastCostAttributeKeys");
    private static final List<String> RULE_FIELDS = List.of("ruleKey", "attributeKey", "valuePolicy", "activationAttributeKeys", "formula");

    private GameCalculationRuleSemantics() {}

    public record Attribute(String valueType, String status) {}
    public record Category(String status) {}
    public record Issue(String field, String code, String message) {
        public Map<String, String> details() { return Map.of("field", field, "code", code, "message", message); }
    }

    public static JsonNode read(JdbcTemplate jdbc, String gameId) {
        List<String> rows = jdbc.queryForList(RULES_SQL, String.class, gameId);
        if (rows.isEmpty()) return null;
        return AggregateJson.tree(rows.getFirst());
    }

    public static Map<String, Attribute> attributes(JdbcTemplate jdbc, String gameId) {
        Map<String, Attribute> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(ATTRIBUTES_SQL, gameId)) {
            result.put((String) row.get("attribute_key"), new Attribute((String) row.get("value_type"), (String) row.get("status")));
        }
        return result;
    }

    public static Map<String, Category> categories(JdbcTemplate jdbc, String gameId) {
        Map<String, Category> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(CATEGORIES_SQL, gameId)) {
            result.put((String) row.get("skill_category_key"), new Category((String) row.get("status")));
        }
        return result;
    }

    public static Issue validate(JsonNode configuration, Map<String, Attribute> attributes, Map<String, Category> categories) {
        String path = "/configuration";
        Issue issue = object(configuration, CONFIG_FIELDS, path);
        if (issue != null) return issue;
        for (String field : List.of("basicAttackCategoryKey", "equipmentPassiveCategoryKey")) {
            JsonNode value = configuration.get(field);
            if (value.isNull()) continue;
            issue = key(value, path + "/" + field);
            if (issue != null) return issue;
            Category category = categories.get(value.textValue());
            if (category == null) return issue(path + "/" + field, "REFERENCE_NOT_FOUND", "分类不属于当前游戏目录");
            if (!"ENABLED".equals(category.status())) return issue(path + "/" + field, "REFERENCE_DISABLED", "分类未启用");
        }
        if (!configuration.get("basicAttackCategoryKey").isNull()
            && configuration.get("basicAttackCategoryKey").equals(configuration.get("equipmentPassiveCategoryKey"))) {
            return issue(path + "/equipmentPassiveCategoryKey", "CATEGORY_USAGE_CONFLICT", "普通攻击与装备被动用途不能绑定同一分类");
        }
        JsonNode costs = configuration.get("ignorableCastCostAttributeKeys");
        if (!costs.isArray()) return issue(path + "/ignorableCastCostAttributeKeys", "ARRAY_REQUIRED", "可明确忽略的施法成本属性必须为完整数组");
        if (costs.size() > 32) return issue(path + "/ignorableCastCostAttributeKeys", "LIMIT", "可明确忽略的施法成本属性最多32项");
        Set<String> costKeys = new LinkedHashSet<>();
        for (int i = 0; i < costs.size(); i++) {
            String costPath = path + "/ignorableCastCostAttributeKeys/" + i;
            issue = key(costs.get(i), costPath);
            if (issue != null) return issue;
            String costKey = costs.get(i).textValue();
            if (!costKeys.add(costKey)) return issue(costPath, "DUPLICATE_KEY", "可明确忽略的施法成本属性重复");
            issue = attribute(costKey, attributes, costPath);
            if (issue != null) return issue;
        }
        for (String field : List.of("criticalChanceAttributeKey", "attackSpeedAttributeKey")) {
            JsonNode value = configuration.get(field);
            if (value.isNull()) continue;
            issue = key(value, path + "/" + field);
            if (issue != null) return issue;
            issue = attribute(value.textValue(), attributes, path + "/" + field);
            if (issue != null) return issue;
        }
        JsonNode minimum = configuration.get("criticalMultiplierMin");
        if (!minimum.isNull()) {
            if (!minimum.isNumber()) return issue(path + "/criticalMultiplierMin", "NUMBER_REQUIRED", "倍率下限必须为明确数值或空值");
            BigDecimal value;
            try { value = minimum.decimalValue(); }
            catch (NumberFormatException exception) { return issue(path + "/criticalMultiplierMin", "RANGE_INVALID", "倍率下限必须为有限非负数"); }
            if (!Double.isFinite(value.doubleValue()) || value.signum() < 0) {
                return issue(path + "/criticalMultiplierMin", "RANGE_INVALID", "倍率下限必须为有限非负数");
            }
        }
        JsonNode rules = configuration.get("attributeDerivations");
        if (!rules.isArray()) return issue(path + "/attributeDerivations", "ARRAY_REQUIRED", "派生规则必须为完整数组");
        if (rules.size() > 4) return issue(path + "/attributeDerivations", "LIMIT", "派生规则最多4项");
        Set<String> ruleKeys = new LinkedHashSet<>(), outputs = new LinkedHashSet<>();
        for (int i = 0; i < rules.size(); i++) {
            JsonNode rule = rules.get(i);
            String rulePath = path + "/attributeDerivations/" + i;
            issue = object(rule, RULE_FIELDS, rulePath);
            if (issue != null) return issue;
            for (String field : List.of("ruleKey", "attributeKey")) {
                issue = key(rule.get(field), rulePath + "/" + field);
                if (issue != null) return issue;
            }
            if (!ruleKeys.add(rule.path("ruleKey").textValue())) return issue(rulePath + "/ruleKey", "DUPLICATE_KEY", "规则标识重复");
            String output = rule.path("attributeKey").textValue();
            if (!outputs.add(output)) return issue(rulePath + "/attributeKey", "DUPLICATE_OUTPUT", "派生输出属性重复");
            issue = attribute(output, attributes, rulePath + "/attributeKey");
            if (issue != null) return issue;
            if ("hp".equals(output)) return issue(rulePath + "/attributeKey", "LIFE_OUTPUT_FORBIDDEN", "生命核心槽由生命管道处理，不能作为普通派生输出");
            if (!rule.get("valuePolicy").isTextual() || !Set.of("set", "multiply").contains(rule.get("valuePolicy").textValue())) {
                return issue(rulePath + "/valuePolicy", "ENUM_INVALID", "派生策略必须明确为set或multiply");
            }
            JsonNode activation = rule.get("activationAttributeKeys");
            if (!activation.isArray() || activation.isEmpty()) return issue(rulePath + "/activationAttributeKeys", "NON_EMPTY_ARRAY_REQUIRED", "激活属性集合必须为非空数组");
            Set<String> seen = new LinkedHashSet<>();
            for (int j = 0; j < activation.size(); j++) {
                String activationPath = rulePath + "/activationAttributeKeys/" + j;
                issue = key(activation.get(j), activationPath);
                if (issue != null) return issue;
                String activationKey = activation.get(j).textValue();
                if (!seen.add(activationKey)) return issue(activationPath, "DUPLICATE_KEY", "激活属性重复");
                issue = attribute(activationKey, attributes, activationPath);
                if (issue != null) return issue;
                if ("hp".equals(activationKey)) return issue(activationPath, "LIFE_ACTIVATION_FORBIDDEN", "普通属性派生不以生命核心槽激活，不开放伤害、治疗或生命资源变化");
            }
        }
        List<JsonNode> allowed = allowedBindings(attributes, outputs);
        for (int i = 0; i < rules.size(); i++) {
            var formulaIssue = FormulaContractValidator.validate(rules.get(i).get("formula"), allowed);
            if (formulaIssue != null) return issue(path + "/attributeDerivations/" + i + "/formula" + formulaIssue.path(),
                formulaIssue.code(), "游戏派生共同公式或授权绑定不合法");
        }
        return null;
    }

    /** 同批输出只授权冻结基础值，其余只授权拥有者的当前帧基础、加成和总值。 */
    public static List<JsonNode> allowedBindings(Map<String, Attribute> attributes, Set<String> outputs) {
        List<JsonNode> result = new ArrayList<>();
        for (String attributeKey : new TreeSet<>(attributes.keySet())) {
            Attribute attribute = attributes.get(attributeKey);
            if (!enabled(attribute)) continue;
            for (String kind : outputs.contains(attributeKey) ? List.of("BASE") : List.of("BASE", "BONUS", "TOTAL")) {
                result.add(JsonNodeFactory.instance.objectNode().put("kind", "attribute").put("object", "source")
                    .put("attributeKey", attributeKey).put("valueKind", kind).put("view", "current_frame"));
            }
        }
        return List.copyOf(result);
    }

    /** 全部作者声明均运输目录，不以某个公式分支或是否激活裁掉输入。 */
    public static Map<String, String> dependencies(JsonNode configuration) {
        Map<String, String> result = new LinkedHashMap<>();
        if (configuration == null || !configuration.isObject()) return result;
        String path = "catalogs.calculationRules.configuration";
        for (String field : List.of("criticalChanceAttributeKey", "attackSpeedAttributeKey")) {
            if (configuration.path(field).isTextual()) result.putIfAbsent(configuration.path(field).textValue(), path + "." + field);
        }
        JsonNode costs = configuration.path("ignorableCastCostAttributeKeys");
        for (int i = 0; costs.isArray() && i < costs.size(); i++) {
            if (costs.get(i).isTextual()) result.putIfAbsent(costs.get(i).textValue(), path + ".ignorableCastCostAttributeKeys[" + i + "]");
        }
        JsonNode rules = configuration.path("attributeDerivations");
        if (!rules.isArray()) return result;
        for (int i = 0; i < rules.size(); i++) {
            JsonNode rule = rules.get(i);
            String rulePath = path + ".attributeDerivations[" + i + "]";
            if (rule.path("attributeKey").isTextual()) result.putIfAbsent(rule.path("attributeKey").textValue(), rulePath + ".attributeKey");
            JsonNode activation = rule.path("activationAttributeKeys");
            for (int j = 0; activation.isArray() && j < activation.size(); j++) {
                JsonNode key = activation.get(j);
                if (key.isTextual()) result.putIfAbsent(key.textValue(), rulePath + ".activationAttributeKeys[" + j + "]");
            }
            JsonNode inputs = rule.path("formula").path("inputs");
            for (int j = 0; inputs.isArray() && j < inputs.size(); j++) {
                JsonNode key = inputs.get(j).path("binding").path("attributeKey");
                if (key.isTextual()) result.putIfAbsent(key.textValue(), rulePath + ".formula/inputs/" + j + "/binding/attributeKey");
            }
        }
        return result;
    }

    /** 分类用途独立追踪目录，不并入属性供值或技能引用索引。 */
    public static Map<String, String> categoryDependencies(JsonNode configuration) {
        Map<String, String> result = new LinkedHashMap<>();
        if (configuration == null || !configuration.isObject()) return result;
        for (String field : List.of("basicAttackCategoryKey", "equipmentPassiveCategoryKey")) {
            if (configuration.path(field).isTextual()) result.putIfAbsent(configuration.path(field).textValue(),
                "catalogs.calculationRules.configuration." + field);
        }
        return result;
    }

    public static Issue object(JsonNode value, Collection<String> fields, String path) {
        if (value == null || !value.isObject()) return issue(path, "OBJECT_REQUIRED", "必须提供完整对象");
        String unknown = value.properties().stream().map(Map.Entry::getKey).filter(field -> !fields.contains(field))
            .sorted(GameCalculationRuleSemantics::compareCodePoints).findFirst().orElse(null);
        if (unknown != null) return issue(path + "/" + unknown.replace("~", "~0").replace("/", "~1"), "UNKNOWN_FIELD", "存在未定义字段");
        for (String field : fields) if (!value.has(field)) return issue(path + "/" + field, "REQUIRED", "完整替换必须显式提供字段");
        return null;
    }

    private static Issue key(JsonNode value, String path) {
        if (!value.isTextual() || !KEY.matcher(value.textValue()).matches()) return issue(path, "FORMAT_INVALID", "标识格式不合法");
        return null;
    }

    private static Issue attribute(String key, Map<String, Attribute> attributes, String path) {
        Attribute attribute = attributes.get(key);
        if (attribute == null) return issue(path, "REFERENCE_NOT_FOUND", "属性不属于当前游戏目录");
        if (!"ENABLED".equals(attribute.status())) return issue(path, "REFERENCE_DISABLED", "属性未启用");
        if (attribute.valueType() == null || !Set.of("DECIMAL", "INTEGER").contains(attribute.valueType())) return issue(path, "VALUE_TYPE_INVALID", "属性必须为合法数值类型");
        return null;
    }

    private static boolean enabled(Attribute attribute) {
        return attribute != null && "ENABLED".equals(attribute.status()) && attribute.valueType() != null
            && Set.of("DECIMAL", "INTEGER").contains(attribute.valueType());
    }

    private static Issue issue(String field, String code, String message) { return new Issue(field, code, message); }

    private static int compareCodePoints(String left, String right) {
        var l = left.codePoints().iterator();
        var r = right.codePoints().iterator();
        while (l.hasNext() && r.hasNext()) {
            int comparison = Integer.compare(l.nextInt(), r.nextInt());
            if (comparison != 0) return comparison;
        }
        return l.hasNext() ? 1 : r.hasNext() ? -1 : 0;
    }
}
