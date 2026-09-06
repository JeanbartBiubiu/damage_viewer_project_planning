package xyz.game.datamanage.service.character;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.character.CharacterAuthoringCheckMapper;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.character.CharacterAttributeDefinition;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckResponse;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckResponse.*;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckRows.*;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skillformula.SkillFormulaNodeType;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperation;
import xyz.game.datamanage.model.skillformula.AttributeOwner;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.support.error.ApiException;

/** 只诊断保存结构与直接接入；不执行机制，也不修改派生引用。 */
@Service
public class CharacterAuthoringCheckService {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private final GamesMapper games;
    private final CharacterMapper characters;
    private final CharacterAuthoringCheckMapper checks;
    private final ObjectReader jsonReader;

    public CharacterAuthoringCheckService(GamesMapper games, CharacterMapper characters,
                                          CharacterAuthoringCheckMapper checks, ObjectMapper objectMapper) {
        this.games = games;
        this.characters = characters;
        this.checks = checks;
        this.jsonReader = objectMapper.reader().with(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS,
            DeserializationFeature.USE_BIG_INTEGER_FOR_INTS);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public CharacterAuthoringCheckResponse check(String gameId, String characterKey) {
        Long count = games.countGames(gameId);
        if (count == null || count == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在", Map.of("gameId", gameId));
        }
        CharacterResponse character = characters.findById(gameId, characterKey);
        if (character == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.CHARACTER_NOT_FOUND", "角色不存在", Map.of("characterKey", characterKey));
        }
        List<Issue> issues = new ArrayList<>();
        checkKey(character.characterKey(), null, "CHARACTER", characterKey, "characterKey", issues);
        checkName(character.name(), null, "CHARACTER", characterKey, "name", issues);
        LevelConfigResponse config = characters.findLevelConfig(gameId);
        boolean validConfig = config != null && config.minLevel() != null && config.maxLevel() != null
            && config.minLevel() >= 1 && config.maxLevel() >= config.minLevel() && config.maxLevel() <= 100;
        if (!validConfig) basic(issues, null, "LEVEL_CONFIG", gameId, "levelConfig", "当前游戏的等级配置缺失或范围不合法");
        int configuredAttributes = checkLevelValues(characterKey, characters.findLevelValuesJson(gameId, characterKey),
            validConfig ? config : null, characters.listAttributeDefinitions(gameId), issues);

        List<AttachedSkill> attached = checks.listAttachedSkills(gameId, characterKey);
        List<Skill> skills = new ArrayList<>();
        if (attached.isEmpty()) review(issues, null, "CHARACTER", characterKey, "skills", "NO_ATTACHED_SKILL", "角色尚未挂载技能，请按资料核对");
        for (AttachedSkill row : attached) {
            skills.add(new Skill(row.skillKey(), row.name(), row.status(), row.maxLevel(), row.sortOrder(),
                row.effectCount(), row.processCount(), row.triggerRuleCount()));
            checkKey(row.skillKey(), row.skillKey(), "SKILL", row.skillKey(), "skillKey", issues);
            checkSort(row.sortOrder(), row.skillKey(), "CHARACTER_SKILL_RELATION", characterKey, "sortOrder", issues);
            if (!row.skillExists()) {
                issues.add(new Issue("ATTACHED_SKILL_MISSING", "ERROR", "关联记录指向不存在的技能", row.skillKey(), "SKILL", row.skillKey(), "skillKey"));
                continue;
            }
            checkName(row.name(), row.skillKey(), "SKILL", row.skillKey(), "name", issues);
            if (row.maxLevel() == null || row.maxLevel() < 1) basic(issues, row.skillKey(), "SKILL", row.skillKey(), "maxLevel", "技能最高等级必须至少为一");
            if (!Set.of("ENABLED", "DISABLED").contains(row.status() == null ? "" : row.status())) basic(issues, row.skillKey(), "SKILL", row.skillKey(), "status", "技能启停状态缺失或不合法");
            if ("DISABLED".equals(row.status())) review(issues, row.skillKey(), "SKILL", row.skillKey(), "status", "ATTACHED_SKILL_DISABLED", "已挂载技能处于停用状态，请核对是否保留");
        }
        checkObjects(checks.listObjects(gameId, characterKey), issues);
        List<Reference> references = new ArrayList<>();
        for (ReferenceRow row : checks.listReferences(gameId, characterKey)) {
            references.add(new Reference(row.sourceSkillKey(), row.sourceType(), row.sourceKey(), row.fieldPath(),
                row.targetType(), row.targetSkillKey(), row.targetKey(), row.targetSubKey()));
            if (!row.targetExists()) issues.add(new Issue("REFERENCE_TARGET_MISSING", "ERROR",
                "直接引用目标不存在：" + row.targetType() + " / " + row.targetSkillKey() + " / " + row.targetKey()
                    + (row.targetSubKey().isEmpty() ? "" : " / " + row.targetSubKey()),
                row.sourceSkillKey(), row.sourceType(), row.sourceKey(), row.fieldPath()));
        }
        issues.sort(Comparator.comparing(Issue::severity).thenComparing(i -> i.skillKey() == null ? "" : i.skillKey())
            .thenComparing(Issue::objectType).thenComparing(i -> i.objectKey() == null ? "" : i.objectKey())
            .thenComparing(Issue::fieldPath).thenComparing(Issue::code));
        int errors = (int) issues.stream().filter(i -> "ERROR".equals(i.severity())).count();
        return new CharacterAuthoringCheckResponse(gameId, characterKey, character.name(), OffsetDateTime.now(ZoneOffset.UTC),
            new Conclusions(errors == 0 ? "NO_ERRORS" : "HAS_ERRORS", "NOT_CHECKED", "NOT_RUN"),
            new Summary(skills.size(), configuredAttributes, errors, issues.size() - errors), skills, references, issues);
    }

    private int checkLevelValues(String characterKey, String raw, LevelConfigResponse config,
                                 List<CharacterAttributeDefinition> definitions, List<Issue> issues) {
        JsonNode root;
        try {
            root = raw == null ? null : jsonReader.readTree(raw);
        } catch (JsonProcessingException ex) {
            levelIssue(issues, characterKey, "levelValues", "原始等级属性不是合法 JSON");
            return 0;
        }
        if (root == null || !root.isObject()) {
            levelIssue(issues, characterKey, "levelValues", "原始等级属性行缺失或整图不是对象");
            return 0;
        }
        Set<String> configured = new LinkedHashSet<>();
        root.elements().forEachRemaining(level -> { if (level.isObject()) level.fieldNames().forEachRemaining(configured::add); });
        if (config == null) return configured.size();
        Set<String> expected = new HashSet<>();
        for (int level = config.minLevel(); level <= config.maxLevel(); level++) expected.add(Integer.toString(level));
        Set<String> actual = new HashSet<>();
        root.fieldNames().forEachRemaining(actual::add);
        if (!expected.equals(actual)) levelIssue(issues, characterKey, "levelValues", "等级键必须恰好覆盖当前等级范围，不能缺少或多出等级");
        Map<String, CharacterAttributeDefinition> catalog = new HashMap<>();
        for (CharacterAttributeDefinition definition : definitions) catalog.put(definition.attributeKey(), definition);
        for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
            String levelKey = Integer.toString(level);
            JsonNode values = root.get(levelKey);
            if (values == null || !values.isObject()) {
                levelIssue(issues, characterKey, "levelValues." + levelKey, "每个配置等级都必须有属性对象，允许完整空属性对象");
                continue;
            }
            for (String key : configured) {
                String path = "levelValues." + levelKey + "." + key;
                JsonNode value = values.get(key);
                CharacterAttributeDefinition definition = catalog.get(key);
                if (value == null) { levelIssue(issues, characterKey, path, "已配置属性必须覆盖全部等级"); continue; }
                if (definition == null) { levelIssue(issues, characterKey, path, "属性不属于当前游戏目录"); continue; }
                if (!value.isNumber()) { levelIssue(issues, characterKey, path, "属性值必须是数值，零是有效数值"); continue; }
                BigDecimal number = value.decimalValue();
                if (definition.valueType() == null
                    || definition.valueType() == AttributeValueType.INTEGER && number.stripTrailingZeros().scale() > 0
                    || definition.minValue() != null && number.compareTo(definition.minValue()) < 0
                    || definition.maxValue() != null && number.compareTo(definition.maxValue()) > 0) {
                    levelIssue(issues, characterKey, path, "属性值不符合目录中的数值类型或上下界");
                }
            }
        }
        return configured.size();
    }

    private void checkObjects(List<ObjectRow> rows, List<Issue> issues) {
        Set<String> connectedEffects = new HashSet<>();
        Set<String> startedProcesses = new HashSet<>();
        List<ObjectRow> passiveProcesses = new ArrayList<>();
        for (ObjectRow row : rows) {
            checkKey(row.objectKey(), row.skillKey(), row.objectType(), row.objectKey(), "key", issues);
            checkName(row.name(), row.skillKey(), row.objectType(), row.objectKey(), "name", issues);
            checkSort(row.sortOrder(), row.skillKey(), row.objectType(), row.objectKey(), "sortOrder", issues);
            JsonNode data;
            try { data = row.dataJson() == null ? null : jsonReader.readTree(row.dataJson()); }
            catch (JsonProcessingException ex) { objectIssue(issues, row, "", "原始对象 JSON 损坏"); continue; }
            if (data == null || !data.isObject()) { objectIssue(issues, row, "", "对象结构缺失或不是对象"); continue; }
            switch (row.objectType()) {
                case "FORMULA" -> checkExpression(data.get("expression"), row, "expression", issues);
                case "EFFECT" -> {
                    List<JsonNode> results = children(data.get("results"), row, "results", "resultKey", true, issues);
                    typedDetails(results, "resultType", SkillEffectResultType.class, row, "results", issues);
                    for (int i = 0; i < results.size(); i++) requiredEnum(results.get(i), "target", SkillEffectTarget.class, row, "results[" + i + "].target", issues);
                    requireObject(data.get("lifecycle"), row, "lifecycle", true, issues);
                }
                case "STATE" -> {
                    requireObject(data.get("detail"), row, "detail", false, issues);
                    String stateType = requiredEnum(data, "stateType", SkillInternalStateType.class, row, "stateType", issues);
                    if ("MODE".equals(stateType)) children(data.path("detail").get("options"), row, "detail.options", "optionKey", true, issues);
                }
                case "PROCESS" -> {
                    String activation = requiredText(data, "activationType", row, "activationType", issues);
                    if ("PASSIVE".equals(activation)) passiveProcesses.add(row);
                    if (activation != null && !Set.of("ACTIVE", "PASSIVE", "CONSUMABLE").contains(activation)) objectIssue(issues, row, "activationType", "过程启动方式不合法");
                    typedDetails(children(data.get("steps"), row, "steps", "stepKey", true, issues),
                        "stepType", SkillProcessStepType.class, row, "steps", issues);
                    requireObject(data.get("cooldown"), row, "cooldown", true, issues);
                    List<JsonNode> bindings = children(data.get("effectBindings"), row, "effectBindings", "bindingKey", false, issues);
                    for (int i = 0; i < bindings.size(); i++) {
                        String effect = requiredText(bindings.get(i), "effectKey", row, "effectBindings[" + i + "].effectKey", issues);
                        if (effect != null) connectedEffects.add(objectKey(row.skillKey(), effect));
                    }
                    children(data.get("stateOperations"), row, "stateOperations", "operationKey", false, issues);
                }
                case "TRIGGER" -> {
                    requireObject(data.get("eventSource"), row, "eventSource", false, issues);
                    requiredEnum(data.path("eventSource"), "eventType", SkillTriggerEventType.class, row, "eventSource.eventType", issues);
                    requireObject(data.path("eventSource").get("detail"), row, "eventSource.detail", false, issues);
                    requireObject(data.get("limits"), row, "limits", false, issues);
                    List<JsonNode> groups = children(data.get("conditionGroups"), row, "conditionGroups", "groupKey", false, issues);
                    for (int i = 0; i < groups.size(); i++) {
                        String path = "conditionGroups[" + i + "].conditions";
                        typedDetails(children(groups.get(i).get("conditions"), row, path, "conditionKey", true, issues),
                            "conditionType", SkillTriggerConditionType.class, row, path, issues);
                    }
                    List<JsonNode> actions = children(data.get("actions"), row, "actions", "actionKey", true, issues);
                    for (int i = 0; i < actions.size(); i++) {
                        JsonNode action = actions.get(i);
                        String path = "actions[" + i + "]";
                        String type = requiredText(action, "actionType", row, path + ".actionType", issues);
                        requireObject(action.get("detail"), row, path + ".detail", false, issues);
                        if ("EXECUTE_EFFECT".equals(type)) {
                            String target = requiredText(action.path("detail"), "effectKey", row, path + ".detail.effectKey", issues);
                            if (target != null) connectedEffects.add(objectKey(row.skillKey(), target));
                        } else if ("START_PROCESS".equals(type)) {
                            String target = requiredText(action.path("detail"), "processKey", row, path + ".detail.processKey", issues);
                            if (target != null) startedProcesses.add(objectKey(row.skillKey(), target));
                        } else if (!"FAIL_PROCESS".equals(type) && type != null) objectIssue(issues, row, path + ".actionType", "动作种类不合法");
                    }
                }
                default -> objectIssue(issues, row, "", "未知对象种类");
            }
        }
        for (ObjectRow row : rows) if ("EFFECT".equals(row.objectType()) && !connectedEffects.contains(objectKey(row.skillKey(), row.objectKey()))) {
            review(issues, row.skillKey(), row.objectType(), row.objectKey(), "", "EFFECT_NOT_CONNECTED", "效果未发现过程挂接或执行效果动作，请人工核对用途");
        }
        for (ObjectRow row : passiveProcesses) if (!startedProcesses.contains(objectKey(row.skillKey(), row.objectKey()))) {
            review(issues, row.skillKey(), row.objectType(), row.objectKey(), "activationType", "PASSIVE_PROCESS_NOT_STARTED", "被动过程未发现启动过程动作，请人工核对启动入口");
        }
    }

    private static List<JsonNode> children(JsonNode value, ObjectRow row, String path, String keyField,
                                            boolean nonEmpty, List<Issue> issues) {
        if (value == null || !value.isArray()) { objectIssue(issues, row, path, "子项列表缺失或不是数组"); return List.of(); }
        if (nonEmpty && value.isEmpty()) objectIssue(issues, row, path, "该对象至少需要一个子项");
        List<JsonNode> result = new ArrayList<>();
        Set<String> keys = new HashSet<>();
        for (int i = 0; i < value.size(); i++) {
            JsonNode child = value.get(i);
            result.add(child);
            if (!child.isObject()) { objectIssue(issues, row, path + "[" + i + "]", "子项必须为对象"); continue; }
            String key = requiredText(child, keyField, row, path + "[" + i + "]." + keyField, issues);
            if (key != null && (!KEY.matcher(key).matches() || !keys.add(key))) objectIssue(issues, row, path + "[" + i + "]." + keyField, "子项标识不合法或重复");
            JsonNode sort = child.get("sortOrder");
            if (sort == null || !sort.isIntegralNumber() || !sort.canConvertToInt() || sort.intValue() < 0
                || "TRIGGER".equals(row.objectType()) && sort.intValue() > 999999) {
                objectIssue(issues, row, path + "[" + i + "].sortOrder", "排序缺失或范围不合法");
            }
            if (!Set.of("conditionKey", "bindingKey").contains(keyField)) {
                JsonNode name = child.get("name");
                checkName(name != null && name.isTextual() ? name.textValue() : null,
                    row.skillKey(), row.objectType(), row.objectKey(), path + "[" + i + "].name", issues);
            }
        }
        return result;
    }

    /** 只检查保存树的节点形状，不计算公式或追踪参数依赖。 */
    private static void checkExpression(JsonNode value, ObjectRow row, String path, List<Issue> issues) {
        requireObject(value, row, path, false, issues);
        if (value == null || !value.isObject()) return;
        String type = requiredEnum(value, "nodeType", SkillFormulaNodeType.class, row, path + ".nodeType", issues);
        if (type == null) return;
        switch (type) {
            case "PARAMETER" -> requiredText(value, "parameterKey", row, path + ".parameterKey", issues);
            case "ATTRIBUTE" -> {
                requiredText(value, "attributeKey", row, path + ".attributeKey", issues);
                requiredEnum(value, "attributeOwner", AttributeOwner.class, row, path + ".attributeOwner", issues);
                requiredEnum(value, "attributeValueKind", AttributeValueKind.class, row, path + ".attributeValueKind", issues);
            }
            case "OPERATION" -> {
                requiredEnum(value, "operation", SkillFormulaOperation.class, row, path + ".operation", issues);
                JsonNode operands = value.get("operands");
                if (operands == null || !operands.isArray() || operands.isEmpty()) {
                    objectIssue(issues, row, path + ".operands", "运算节点必须包含非空的子节点数组");
                    return;
                }
                for (int i = 0; i < operands.size(); i++) checkExpression(operands.get(i), row, path + ".operands[" + i + "]", issues);
            }
            default -> throw new IllegalStateException("未支持的公式节点");
        }
    }

    private static void requireObject(JsonNode value, ObjectRow row, String path, boolean nullable, List<Issue> issues) {
        if (value == null || !value.isObject() && !(nullable && value.isNull())) objectIssue(issues, row, path, "字段缺失或结构不合法");
    }
    private static <T extends Enum<T>> void typedDetails(List<JsonNode> children, String typeField, Class<T> type,
                                                       ObjectRow row, String path, List<Issue> issues) {
        for (int i = 0; i < children.size(); i++) {
            requiredEnum(children.get(i), typeField, type, row, path + "[" + i + "]." + typeField, issues);
            requireObject(children.get(i).get("detail"), row, path + "[" + i + "].detail", false, issues);
        }
    }
    private static <T extends Enum<T>> String requiredEnum(JsonNode owner, String field, Class<T> type,
                                                         ObjectRow row, String path, List<Issue> issues) {
        String value = requiredText(owner, field, row, path, issues);
        if (value != null) try { Enum.valueOf(type, value); }
        catch (IllegalArgumentException ex) { objectIssue(issues, row, path, "字段种类不合法"); return null; }
        return value;
    }
    private static String requiredText(JsonNode owner, String field, ObjectRow row, String path, List<Issue> issues) {
        JsonNode value = owner.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) { objectIssue(issues, row, path, "必填标识缺失或不是文本"); return null; }
        return value.textValue();
    }
    private static String objectKey(String skill, String key) { return skill + "\u0000" + key; }
    private static void checkKey(String value, String skill, String type, String key, String path, List<Issue> issues) {
        if (value == null || !KEY.matcher(value).matches()) basic(issues, skill, type, key, path, "稳定标识缺失或格式不合法");
    }
    private static void checkName(String name, String skill, String type, String key, String path, List<Issue> issues) {
        if (name == null || name.isBlank() || name.length() > 100) basic(issues, skill, type, key, path, "名称不能为空或超过一百个字符");
    }
    private static void checkSort(Integer sort, String skill, String type, String key, String path, List<Issue> issues) {
        if (sort == null || sort < 0) basic(issues, skill, type, key, path, "排序缺失或小于零");
    }
    private static void objectIssue(List<Issue> issues, ObjectRow row, String path, String message) {
        basic(issues, row.skillKey(), row.objectType(), row.objectKey(), path, message);
    }
    private static void basic(List<Issue> issues, String skill, String type, String key, String path, String message) {
        issues.add(new Issue("BASIC_FIELD_INVALID", "ERROR", message, skill, type, key, path));
    }
    private static void levelIssue(List<Issue> issues, String key, String path, String message) {
        issues.add(new Issue("LEVEL_VALUES_INVALID", "ERROR", message, null, "CHARACTER_ATTRIBUTES", key, path));
    }
    private static void review(List<Issue> issues, String skill, String type, String key, String path, String code, String message) {
        issues.add(new Issue(code, "REVIEW", message, skill, type, key, path));
    }
}
