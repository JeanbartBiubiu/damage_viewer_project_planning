package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;
import xyz.game.datamanage.model.gamevamp.GameVampRule;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Catalogs;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Combatant;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.DamageTypeEntry;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Reference;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.service.character.CharacterService;
import xyz.game.datamanage.service.damagetype.DamageTypeService;
import xyz.game.datamanage.service.gamevamp.GameVampRuleService;
import xyz.game.datamanage.service.modifierzone.ModifierZoneService;
import xyz.game.datamanage.service.skillcategory.SkillCategoryService;
import xyz.game.datamanage.service.skillconfiguration.SkillConfigurationService;
import xyz.game.datamanage.service.skillrelation.SkillRelationService;
import xyz.game.datamanage.service.status.StatusService;
import xyz.game.datamanage.support.authoring.SkillObjectReferences;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

/** 首批仅装配两个普通角色与 A 已挂载的共享普攻；B 不产生独立动作。 */
@Service
public class SimulationSnapshotService {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String SHARED_BASIC_ATTACK = "shared_basic_attack";

    private final CharacterService characters;
    private final CharacterMapper characterMapper;
    private final SkillRelationService relations;
    private final SkillConfigurationService configurations;
    private final AttributeService attributes;
    private final SkillCategoryService categories;
    private final DamageTypeService damageTypes;
    private final ModifierZoneService zones;
    private final StatusService statuses;
    private final GameVampRuleService vampRules;
    private final ObjectMapper json;

    public SimulationSnapshotService(CharacterService characters, CharacterMapper characterMapper,
                                     SkillRelationService relations,
                                     SkillConfigurationService configurations, AttributeService attributes,
                                     SkillCategoryService categories, DamageTypeService damageTypes,
                                     ModifierZoneService zones, StatusService statuses,
                                     GameVampRuleService vampRules, ObjectMapper json) {
        this.characters = characters;
        this.characterMapper = characterMapper;
        this.relations = relations;
        this.configurations = configurations;
        this.attributes = attributes;
        this.categories = categories;
        this.damageTypes = damageTypes;
        this.zones = zones;
        this.statuses = statuses;
        this.vampRules = vampRules;
        this.json = json;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SimulationSnapshotResponse get(String gameId, Selection selection) {
        validateSelection(selection);
        LevelConfigResponse levels = characters.getLevelConfig(gameId);
        validateLevel("sourceLevel", selection.sourceLevel(), levels);
        validateLevel("targetLevel", selection.targetLevel(), levels);
        Combatant source = combatant(gameId, selection.sourceCharacterKey(), selection.sourceLevel(), "source");
        Combatant target = combatant(gameId, selection.targetCharacterKey(), selection.targetLevel(), "target");
        if (source.attachedSkills().stream().noneMatch(r -> selection.basicAttackSkillKey().equals(r.skillKey()))) {
            throw invalid("source.attachedSkills", "SKILL_NOT_ATTACHED", "A 未挂载所选普通攻击");
        }
        SkillConfigurationResponse skill = configurations.get(gameId, selection.basicAttackSkillKey());
        if (skill.skill().status() != SkillStatus.ENABLED) {
            throw invalid("skillConfigurations[0].skill.status", "SKILL_DISABLED", "所选普通攻击未启用");
        }
        if (skill.skill().maxLevel() == null || selection.basicAttackLevel() > skill.skill().maxLevel()) {
            throw invalid("basicAttackLevel", "LEVEL_OUT_OF_RANGE", "普通攻击等级超过技能最高等级");
        }
        validateParameters(skill, selection);

        List<SkillObjectReferences.Reference> referenced = actualReferences(gameId, skill);
        Map<String, String> attributeKeys = new TreeMap<>();
        source.selectedLevelValues().fieldNames().forEachRemaining(key ->
            attributeKeys.putIfAbsent(key, "source.selectedLevelValues." + key));
        target.selectedLevelValues().fieldNames().forEachRemaining(key ->
            attributeKeys.putIfAbsent(key, "target.selectedLevelValues." + key));
        Map<String, String> categoryKeys = new TreeMap<>();
        for (int i = 0; i < skill.skill().skillCategoryKeys().size(); i++) {
            categoryKeys.putIfAbsent(skill.skill().skillCategoryKeys().get(i),
                "skillConfigurations[0].skill.skillCategoryKeys[" + i + "]");
        }
        Map<String, String> damageTypeKeys = new TreeMap<>();
        Map<String, String> zoneKeys = new TreeMap<>();
        Map<String, String> statusKeys = new TreeMap<>();
        List<Reference> references = new ArrayList<>();
        for (SkillObjectReferences.Reference row : referenced) {
            String path = referencePath(row.sourceType().name(), row.sourceKey(), row.fieldPath());
            Target dependency = row.target();
            switch (dependency.type()) {
                case ATTRIBUTE -> attributeKeys.putIfAbsent(dependency.key(), path);
                case CATEGORY -> categoryKeys.putIfAbsent(dependency.key(), path);
                case DAMAGE_TYPE -> damageTypeKeys.putIfAbsent(dependency.key(), path);
                case MODIFIER_ZONE -> zoneKeys.putIfAbsent(dependency.key(), path);
                case STATUS -> statusKeys.putIfAbsent(dependency.key(), path);
                default -> { }
            }
            references.add(new Reference(row.sourceSkillKey(), row.sourceType().name(), row.sourceKey(),
                row.fieldPath(), dependency.type().name(), dependency.skillKey(), dependency.key(), dependency.subKey()));
        }

        GameVampRules vamp = vampRules.get(gameId);
        for (int i = 0; i < vamp.rules().size(); i++) {
            GameVampRule rule = vamp.rules().get(i);
            attributeKeys.putIfAbsent(rule.sourceAttributeKey(), "catalogs.vampRules.rules[" + i + "].sourceAttributeKey");
            for (int c = 0; c < rule.skillCategoryKeys().size(); c++) {
                categoryKeys.putIfAbsent(rule.skillCategoryKeys().get(c),
                    "catalogs.vampRules.rules[" + i + "].skillCategoryKeys[" + c + "]");
            }
        }
        List<DamageTypeEntry> selectedDamageTypes = new ArrayList<>();
        for (var dependency : damageTypeKeys.entrySet()) {
            String key = dependency.getKey();
            DamageTypeResponse type = readDependency(() -> damageTypes.get(gameId, key), dependency.getValue());
            requireEnabled(type.status(), dependency.getValue());
            if (!type.formulaConfigured()) {
                throw invalid("catalogs.damageTypes." + key + ".formula", "FORMULA_MISSING", "伤害类型缺少五阶段结算公式");
            }
            DamageTypeFormulaResponse formula = readDependency(() -> damageTypes.getFormula(gameId, key),
                "catalogs.damageTypes." + key + ".formula");
            if (formula.formula() == null || formula.formula().resistanceBeforePenetration() == null
                || formula.formula().penetrationPercent() == null || formula.formula().penetrationFlat() == null
                || formula.formula().effectiveResistance() == null || formula.formula().resistanceFactor() == null) {
                throw invalid("catalogs.damageTypes." + key + ".formula", "FORMULA_MISSING", "伤害类型缺少完整五阶段结算公式");
            }
            collectAttributeKeys(json.valueToTree(formula.formula()), attributeKeys,
                "catalogs.damageTypes." + key + ".formula");
            selectedDamageTypes.add(new DamageTypeEntry(type, formula));
        }
        collectAttributeKeys(json.valueToTree(skill), attributeKeys, "skillConfigurations[0]");
        Catalogs catalogs = new Catalogs(levels, loadAttributes(gameId, attributeKeys),
            loadCategories(gameId, categoryKeys), List.copyOf(selectedDamageTypes),
            loadZones(gameId, zoneKeys), loadStatuses(gameId, statusKeys), vamp);
        SimulationSnapshotResponse content = new SimulationSnapshotResponse(gameId, selection, source, target,
            List.of(skill), catalogs, List.copyOf(references), null, null);
        return new SimulationSnapshotResponse(gameId, selection, source, target, List.of(skill), catalogs,
            List.copyOf(references), digest(content), OffsetDateTime.now(ZoneOffset.UTC));
    }

    private Combatant combatant(String gameId, String characterKey, int level, String side) {
        CharacterResponse character = characters.get(gameId, characterKey);
        JsonNode raw;
        try {
            String stored = characterMapper.findLevelValuesJson(gameId, characterKey);
            raw = stored == null ? null : json.readTree(stored);
        } catch (JsonProcessingException ex) {
            throw invalid(side + ".attributes.levelValues", "INVALID_STORED_DATA", "角色等级属性内容无法解析");
        }
        JsonNode selected = raw == null ? null : raw.path(Integer.toString(level));
        if (selected == null || !selected.isObject() || selected.isEmpty()) {
            throw invalid(side + ".attributes.levelValues." + level, "LEVEL_VALUES_MISSING", "所选等级没有录入属性");
        }
        CharacterAttributesResponse attrs = readDependency(() -> characters.getAttributes(gameId, characterKey),
            side + ".attributes.levelValues");
        // 任一等级已经录入的属性都属于固有等级图；所选行缺少它不能冒充场景附加属性。
        Set<String> configuredKeys = new TreeSet<>();
        raw.elements().forEachRemaining(row -> {
            if (row.isObject()) row.fieldNames().forEachRemaining(configuredKeys::add);
        });
        for (String key : configuredKeys) {
            JsonNode value = selected.get(key);
            if (value == null || !value.isNumber()) {
                throw invalid(side + ".attributes.levelValues." + level + "." + key,
                    "NUMBER_MISSING", "所选等级属性不是数值");
            }
            JsonNode materialized = attrs.levelValues().path(Integer.toString(level)).get(key);
            if (materialized == null || !materialized.isNumber()
                || value.decimalValue().compareTo(materialized.decimalValue()) != 0) {
                throw invalid(side + ".attributes.levelValues." + level + "." + key,
                    "LEVEL_VALUES_INCOMPLETE", "所选属性的等级图不完整或未被当前管理读取保留");
            }
        }
        List<CharacterSkillRelationResponse> attached = relations.listCharacterRelations(gameId, characterKey, null).items();
        return new Combatant(character, attrs, selected.deepCopy(), List.copyOf(attached));
    }

    private void validateParameters(SkillConfigurationResponse skill, Selection selection) {
        for (SkillParameterResponse parameter : skill.parameters()) {
            SkillParameterValueMode mode = parameter.valueMode();
            String path = "skillConfigurations[0].parameters." + parameter.parameterKey();
            if (mode == SkillParameterValueMode.FIXED && parameter.fixedValue() == null) {
                throw invalid(path + ".fixedValue", "NUMBER_MISSING", "固定参数没有数值");
            }
            if (mode == SkillParameterValueMode.SKILL_LEVEL
                && (parameter.levelValues() == null
                    || parameter.levelValues().get(Integer.toString(selection.basicAttackLevel())) == null)) {
                throw invalid(path + ".levelValues." + selection.basicAttackLevel(),
                    "NUMBER_MISSING", "所选技能等级缺少参数数值");
            }
            if (mode == SkillParameterValueMode.CHARACTER_LEVEL
                && (parameter.levelValues() == null
                    || parameter.levelValues().get(Integer.toString(selection.sourceLevel())) == null)) {
                throw invalid(path + ".levelValues." + selection.sourceLevel(),
                    "NUMBER_MISSING", "A 的等级缺少技能参数数值");
            }
        }
    }

    private List<AttributeResponse> loadAttributes(String gameId, Map<String, String> keys) {
        List<AttributeResponse> result = new ArrayList<>();
        for (var dependency : keys.entrySet()) {
            AttributeResponse value = readDependency(() -> attributes.get(gameId, dependency.getKey()), dependency.getValue());
            requireEnabled(value.status(), dependency.getValue());
            result.add(value);
        }
        return List.copyOf(result);
    }

    private List<SkillCategoryResponse> loadCategories(String gameId, Map<String, String> keys) {
        List<SkillCategoryResponse> result = new ArrayList<>();
        for (var dependency : keys.entrySet()) {
            SkillCategoryResponse value = readDependency(() -> categories.get(gameId, dependency.getKey()), dependency.getValue());
            requireEnabled(value.status(), dependency.getValue());
            result.add(value);
        }
        return List.copyOf(result);
    }

    private List<ModifierZoneResponse> loadZones(String gameId, Map<String, String> keys) {
        List<ModifierZoneResponse> result = new ArrayList<>();
        for (var dependency : keys.entrySet()) {
            ModifierZoneResponse value = readDependency(() -> zones.get(gameId, dependency.getKey()), dependency.getValue());
            requireEnabled(value.status(), dependency.getValue());
            result.add(value);
        }
        return List.copyOf(result);
    }

    private List<StatusResponse> loadStatuses(String gameId, Map<String, String> keys) {
        List<StatusResponse> result = new ArrayList<>();
        for (var dependency : keys.entrySet()) {
            StatusResponse value = readDependency(() -> statuses.get(gameId, dependency.getKey()), dependency.getValue());
            requireEnabled(value.status(), dependency.getValue());
            result.add(value);
        }
        return List.copyOf(result);
    }

    private void collectAttributeKeys(JsonNode node, Map<String, String> keys, String path) {
        if (node.isObject()) {
            JsonNode key = node.get("attributeKey");
            if (key != null && key.isTextual() && !key.asText().isBlank()) keys.putIfAbsent(key.asText(), path + ".attributeKey");
            if ("SOURCE_CRIT_CHANCE".equals(node.path("critical").path("mode").asText())) {
                keys.putIfAbsent("critical_strike_chance", path + ".critical.mode");
            }
            node.properties().forEach(entry -> collectAttributeKeys(entry.getValue(), keys, path + "." + entry.getKey()));
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                collectAttributeKeys(node.get(i), keys, path + "[" + i + "]");
            }
        }
    }

    private List<SkillObjectReferences.Reference> actualReferences(String gameId, SkillConfigurationResponse skill) {
        List<Aggregate> objects = new ArrayList<>();
        JsonNode data = json.valueToTree(skill);
        addAggregates(objects, data.path("formulas"), SourceType.FORMULA, "formulaKey", skill.skill().skillKey());
        addAggregates(objects, data.path("effects"), SourceType.EFFECT, "effectKey", skill.skill().skillKey());
        addAggregates(objects, data.path("internalStates"), SourceType.STATE, "stateKey", skill.skill().skillKey());
        addAggregates(objects, data.path("processes"), SourceType.PROCESS, "processKey", skill.skill().skillKey());
        addAggregates(objects, data.path("triggerRules"), SourceType.TRIGGER, "ruleKey", skill.skill().skillKey());
        try {
            List<SkillObjectReferences.Reference> references = SkillObjectReferences.extract(gameId, objects);
            Set<Target> dictionaryAndParameters = new HashSet<>();
            for (SkillParameterResponse parameter : skill.parameters()) {
                if (!dictionaryAndParameters.add(new Target(TargetType.PARAMETER, skill.skill().skillKey(), parameter.parameterKey(), ""))) {
                    throw invalid("skillConfigurations[0].parameters." + parameter.parameterKey(), "DUPLICATE_KEY", "参数标识重复");
                }
            }
            for (SkillObjectReferences.Reference reference : references) {
                Target dependency = reference.target();
                if ((!dependency.skillKey().isEmpty() && !skill.skill().skillKey().equals(dependency.skillKey()))
                    || (dependency.type() == TargetType.SKILL && !skill.skill().skillKey().equals(dependency.key()))) {
                    throw invalid(referencePath(reference.sourceType().name(), reference.sourceKey(), reference.fieldPath()),
                        "CROSS_SKILL_NOT_SUPPORTED", "首批普攻快照不装配跨技能引用");
                }
                // 目录稍后按真实键读取；同技能对象与子项在此核对，不能用自身引用冒充已存在目标。
                if (dependency.skillKey().isEmpty()) dictionaryAndParameters.add(dependency);
            }
            SkillObjectReferences.extractAndValidate(gameId, objects, dictionaryAndParameters);
            return references.stream().sorted(Comparator.comparing((SkillObjectReferences.Reference r) -> r.sourceType().name())
                .thenComparing(SkillObjectReferences.Reference::sourceKey)
                .thenComparing(SkillObjectReferences.Reference::fieldPath)
                .thenComparing(r -> r.target().type().name()).thenComparing(r -> r.target().skillKey())
                .thenComparing(r -> r.target().key()).thenComparing(r -> r.target().subKey())).toList();
        } catch (ApiException ex) {
            if ("409.SIMULATION_SNAPSHOT_INVALID".equals(ex.getCode())) throw ex;
            List<Map<String, Object>> issues = new ArrayList<>();
            if (ex.getDetails().get("fieldIssues") instanceof List<?> original) {
                for (Object item : original) {
                    if (!(item instanceof Map<?, ?> issue)) continue;
                    Map<String, Object> translated = new LinkedHashMap<>();
                    issue.forEach((key, value) -> translated.put(key.toString(), value));
                    String field = String.valueOf(issue.get("field"));
                    translated.put("field", issue.get("sourceType") instanceof String type
                        && issue.get("sourceKey") instanceof String key
                        ? referencePath(type, key, field) : "skillConfigurations[0]." + field);
                    translated.put("code", "MISSING_REFERENCE_TARGET".equals(issue.get("code"))
                        ? "REFERENCE_MISSING" : "INVALID_STORED_DATA");
                    issues.add(translated);
                }
            }
            throw new ApiException(HttpStatus.CONFLICT, "409.SIMULATION_SNAPSHOT_INVALID", ex.getMessage(),
                Map.of("fieldIssues", List.copyOf(issues)));
        }
    }

    private void addAggregates(List<Aggregate> objects, JsonNode rows, SourceType type, String keyField, String skillKey) {
        Set<String> keys = new HashSet<>();
        for (JsonNode row : rows) {
            String key = row.path(keyField).asText();
            if (key.isBlank() || !keys.add(key)) {
                throw invalid(referencePath(type.name(), key, keyField), "DUPLICATE_KEY", "对象标识缺失或重复");
            }
            ObjectNode aggregate = row.deepCopy();
            if (type == SourceType.TRIGGER) {
                ObjectNode limits = aggregate.putObject("limits");
                for (String field : List.of("perTargetCooldown", "maxTriggersPerProcess", "oncePerUse")) {
                    limits.set(field, aggregate.get(field));
                }
            }
            objects.add(new Aggregate(type, skillKey, key, aggregate));
        }
    }

    private static String referencePath(String type, String key, String field) {
        String collection = switch (type) {
            case "FORMULA" -> "formulas";
            case "EFFECT" -> "effects";
            case "STATE" -> "internalStates";
            case "PROCESS" -> "processes";
            case "TRIGGER" -> "triggerRules";
            default -> type;
        };
        if ("TRIGGER".equals(type) && field.startsWith("limits.")) field = field.substring("limits.".length());
        return "skillConfigurations[0]." + collection + "." + key + "." + field;
    }

    private static <T> T readDependency(Supplier<T> read, String field) {
        try {
            T value = read.get();
            if (value == null) throw invalid(field, "REFERENCE_MISSING", "所选场景引用的对象不存在");
            return value;
        } catch (ApiException ex) {
            if (ex.getStatus() == HttpStatus.NOT_FOUND) {
                throw invalid(field, "REFERENCE_MISSING", "所选场景引用的对象不存在");
            }
            throw ex;
        } catch (IllegalStateException ex) {
            throw invalid(field, "INVALID_STORED_DATA", "所选场景引用的已存配置不合法");
        }
    }

    private static void validateSelection(Selection choice) {
        if (choice == null) throw invalid("selection", "REQUIRED", "必须提供场景选择");
        requireKey("sourceCharacterKey", choice.sourceCharacterKey());
        requireKey("targetCharacterKey", choice.targetCharacterKey());
        requireKey("basicAttackSkillKey", choice.basicAttackSkillKey());
        if (!SHARED_BASIC_ATTACK.equals(choice.basicAttackSkillKey())) {
            throw invalid("basicAttackSkillKey", "UNSUPPORTED", "首批只接入共享普通攻击");
        }
        if (choice.basicAttackLevel() < 1) {
            throw invalid("basicAttackLevel", "LEVEL_OUT_OF_RANGE", "普通攻击等级必须至少为一");
        }
    }

    private static void validateLevel(String field, int level, LevelConfigResponse config) {
        if (level < config.minLevel() || level > config.maxLevel()) {
            throw invalid(field, "LEVEL_OUT_OF_RANGE", "角色等级超出当前游戏配置范围");
        }
    }

    private static void requireKey(String field, String value) {
        if (value == null || !KEY.matcher(value).matches()) {
            throw invalid(field, "KEY_INVALID", "标识格式不合法");
        }
    }

    private static void requireEnabled(Enum<?> status, String field) {
        if (status == null || !"ENABLED".equals(status.name())) {
            throw invalid(field, "REFERENCE_DISABLED", "所选场景引用的目录项未启用");
        }
    }

    private static ApiException invalid(String field, String code, String message) {
        return new ApiException(HttpStatus.CONFLICT, "409.SIMULATION_SNAPSHOT_INVALID", message,
            Map.of("fieldIssues", List.of(Map.of("field", field, "code", code, "message", message))));
    }

    private String digest(SimulationSnapshotResponse content) {
        try {
            JsonNode canonical = canonical(json.valueToTree(content));
            byte[] bytes = json.writeValueAsBytes(canonical);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (JsonProcessingException | NoSuchAlgorithmException ex) {
            throw new IllegalStateException("Could not calculate simulation snapshot digest", ex);
        }
    }

    private JsonNode canonical(JsonNode value) {
        if (value.isObject()) {
            ObjectNode sorted = json.createObjectNode();
            value.properties().stream().sorted(Map.Entry.comparingByKey())
                .forEach(entry -> sorted.set(entry.getKey(), canonical(entry.getValue())));
            return sorted;
        }
        if (value.isArray()) {
            ArrayNode result = json.createArrayNode();
            value.forEach(item -> result.add(canonical(item)));
            return result;
        }
        return value;
    }
}
