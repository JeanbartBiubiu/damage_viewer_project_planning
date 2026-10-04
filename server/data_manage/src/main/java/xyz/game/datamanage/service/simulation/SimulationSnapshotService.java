package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
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
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;
import xyz.game.datamanage.model.equipment.EquipmentAttributesResponse;
import xyz.game.datamanage.model.equipment.EquipmentResponse;
import xyz.game.datamanage.model.gamevamp.GameVampRule;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Catalogs;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Combatant;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.DamageTypeEntry;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Reference;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SelectedEquipment;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.service.character.CharacterService;
import xyz.game.datamanage.service.damagetype.DamageTypeService;
import xyz.game.datamanage.service.equipment.EquipmentService;
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

@Service
public class SimulationSnapshotService {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String SHARED_BASIC_ATTACK = "shared_basic_attack";

    private final CharacterService characters;
    private final CharacterMapper characterMapper;
    private final EquipmentService equipment;
    private final EquipmentMapper equipmentMapper;
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
                                     EquipmentService equipment, EquipmentMapper equipmentMapper,
                                     SkillRelationService relations,
                                     SkillConfigurationService configurations, AttributeService attributes,
                                     SkillCategoryService categories, DamageTypeService damageTypes,
                                     ModifierZoneService zones, StatusService statuses,
                                     GameVampRuleService vampRules, ObjectMapper json) {
        this.characters = characters;
        this.characterMapper = characterMapper;
        this.equipment = equipment;
        this.equipmentMapper = equipmentMapper;
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
        Selection choice = new Selection(selection.sourceCharacterKey(), selection.sourceLevel(),
            selection.targetCharacterKey(), selection.targetLevel(), selection.basicAttackSkillKey(),
            selection.basicAttackLevel(), normalizeEquipmentKeys(selection.sourceEquipmentKeys(), "sourceEquipmentKeys"),
            normalizeEquipmentKeys(selection.targetEquipmentKeys(), "targetEquipmentKeys"));
        LevelConfigResponse levels = characters.getLevelConfig(gameId);
        validateLevel("sourceLevel", choice.sourceLevel(), levels);
        validateLevel("targetLevel", choice.targetLevel(), levels);
        Combatant source = combatant(gameId, choice.sourceCharacterKey(), choice.sourceLevel(),
            choice.sourceEquipmentKeys(), "source");
        Combatant target = combatant(gameId, choice.targetCharacterKey(), choice.targetLevel(),
            choice.targetEquipmentKeys(), "target");
        if (source.attachedSkills().stream().noneMatch(relation -> choice.basicAttackSkillKey().equals(relation.skillKey()))) {
            throw invalid("source.attachedSkills", "SKILL_NOT_ATTACHED", "A 未挂载所选普通攻击");
        }
        List<SkillConfigurationResponse> skills = selectedSkillConfigurations(gameId, choice, source, target);
        Map<String, Integer> skillIndices = new TreeMap<>();
        for (int skillIndex = 0; skillIndex < skills.size(); skillIndex++) {
            skillIndices.put(skills.get(skillIndex).skill().skillKey(), skillIndex);
        }
        List<SkillObjectReferences.Reference> referenced = actualReferences(gameId, skills, skillIndices);
        Map<String, String> attributeKeys = new TreeMap<>();
        source.selectedLevelValues().fieldNames().forEachRemaining(key ->
            attributeKeys.putIfAbsent(key, "source.selectedLevelValues." + key));
        target.selectedLevelValues().fieldNames().forEachRemaining(key ->
            attributeKeys.putIfAbsent(key, "target.selectedLevelValues." + key));
        collectEquipmentAttributeKeys(source, "source", attributeKeys);
        collectEquipmentAttributeKeys(target, "target", attributeKeys);
        Map<String, String> categoryKeys = new TreeMap<>();
        for (int skillIndex = 0; skillIndex < skills.size(); skillIndex++) {
            SkillConfigurationResponse skill = skills.get(skillIndex);
            for (int categoryIndex = 0; categoryIndex < skill.skill().skillCategoryKeys().size(); categoryIndex++) {
                categoryKeys.putIfAbsent(skill.skill().skillCategoryKeys().get(categoryIndex),
                    "skillConfigurations[" + skillIndex + "].skill.skillCategoryKeys[" + categoryIndex + "]");
            }
        }
        Map<String, String> damageTypeKeys = new TreeMap<>();
        Map<String, String> zoneKeys = new TreeMap<>();
        Map<String, String> statusKeys = new TreeMap<>();
        List<Reference> references = new ArrayList<>();
        for (SkillObjectReferences.Reference row : referenced) {
            String path = referencePath(skillIndices.get(row.sourceSkillKey()), row.sourceType().name(),
                row.sourceKey(), row.fieldPath());
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

        for (int skillIndex = 0; skillIndex < skills.size(); skillIndex++) {
            collectAttributeKeys(json.valueToTree(skills.get(skillIndex)), attributeKeys, "skillConfigurations[" + skillIndex + "]");
        }
        GameVampRules vamp = vampRules.get(gameId);
        for (int ruleIndex = 0; ruleIndex < vamp.rules().size(); ruleIndex++) {
            GameVampRule rule = vamp.rules().get(ruleIndex);
            attributeKeys.putIfAbsent(rule.sourceAttributeKey(), "catalogs.vampRules.rules[" + ruleIndex + "].sourceAttributeKey");
            for (int categoryIndex = 0; categoryIndex < rule.skillCategoryKeys().size(); categoryIndex++) {
                categoryKeys.putIfAbsent(rule.skillCategoryKeys().get(categoryIndex),
                    "catalogs.vampRules.rules[" + ruleIndex + "].skillCategoryKeys[" + categoryIndex + "]");
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
        List<AttributeResponse> selectedAttributes = loadAttributes(gameId, attributeKeys);
        validateEquipmentAttributes(source, "source", selectedAttributes);
        validateEquipmentAttributes(target, "target", selectedAttributes);
        Catalogs catalogs = new Catalogs(levels, selectedAttributes,
            loadCategories(gameId, categoryKeys), List.copyOf(selectedDamageTypes),
            loadZones(gameId, zoneKeys), loadStatuses(gameId, statusKeys), vamp);
        SimulationSnapshotResponse content = new SimulationSnapshotResponse(gameId, choice, source, target,
            skills, catalogs, List.copyOf(references), null, null);
        return new SimulationSnapshotResponse(gameId, choice, source, target, skills, catalogs,
            List.copyOf(references), digest(content), OffsetDateTime.now(ZoneOffset.UTC));
    }

    private Combatant combatant(String gameId, String characterKey, int level, List<String> equipmentKeys, String side) {
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
        return new Combatant(character, attrs, selected.deepCopy(), List.copyOf(attached),
            selectedEquipment(gameId, equipmentKeys, side));
    }

    private List<SelectedEquipment> selectedEquipment(String gameId, List<String> keys, String side) {
        List<SelectedEquipment> selected = new ArrayList<>();
        for (int equipmentIndex = 0; equipmentIndex < keys.size(); equipmentIndex++) {
            String key = keys.get(equipmentIndex);
            String path = side + ".selectedEquipment[" + equipmentIndex + "]";
            String attributePath = path + ".attributes.attributeValues";
            EquipmentResponse item = equipment.get(gameId, key);
            JsonNode raw;
            try {
                String stored = equipmentMapper.findAttributeValuesJson(gameId, key);
                raw = stored == null ? null : json.readTree(stored);
            } catch (JsonProcessingException ex) {
                throw invalid(attributePath, "INVALID_STORED_DATA", "装备属性内容无法解析");
            }
            if (raw == null || !raw.isObject()) {
                throw invalid(attributePath, "INVALID_STORED_DATA", "装备属性必须是已录入的数值映射");
            }
            for (var entry : raw.properties()) {
                if (!KEY.matcher(entry.getKey()).matches()) {
                    throw invalid(attributePath + "." + entry.getKey(), "KEY_INVALID", "装备属性标识格式不合法");
                }
                if (!entry.getValue().isNumber() || !Double.isFinite(entry.getValue().doubleValue())) {
                    throw invalid(attributePath + "." + entry.getKey(), "NUMBER_INVALID", "装备属性必须是有限数值");
                }
            }
            EquipmentAttributesResponse itemAttributes = readDependency(() -> equipment.getAttributes(gameId, key), attributePath);
            JsonNode materialized = itemAttributes.attributeValues();
            if (!key.equals(itemAttributes.equipmentKey()) || materialized == null || !materialized.isObject()) {
                throw invalid(attributePath, "ATTRIBUTE_VALUES_INCOMPLETE", "装备原始属性未被当前管理读取完整保留");
            }
            for (var entry : raw.properties()) {
                JsonNode value = materialized.get(entry.getKey());
                if (value == null || !value.isNumber() || !Double.isFinite(value.doubleValue())
                    || entry.getValue().decimalValue().compareTo(value.decimalValue()) != 0) {
                    throw invalid(attributePath + "." + entry.getKey(), "ATTRIBUTE_VALUES_INCOMPLETE",
                        "装备原始属性未被当前管理读取完整保留");
                }
            }
            if (materialized.size() != raw.size()) {
                throw invalid(attributePath, "ATTRIBUTE_VALUES_INCOMPLETE", "装备原始属性未被当前管理读取完整保留");
            }
            List<EquipmentSkillRelationResponse> attached = readDependency(
                () -> relations.listEquipmentRelations(gameId, key, null), path + ".attachedSkills").items().stream()
                .sorted(Comparator.comparing(EquipmentSkillRelationResponse::sortOrder,
                        Comparator.nullsFirst(Comparator.naturalOrder()))
                    .thenComparing(EquipmentSkillRelationResponse::skillKey, Comparator.nullsFirst(Comparator.naturalOrder())))
                .toList();
            Set<String> skillKeys = new HashSet<>();
            for (int relationIndex = 0; relationIndex < attached.size(); relationIndex++) {
                EquipmentSkillRelationResponse relation = attached.get(relationIndex);
                String relationPath = path + ".attachedSkills[" + relationIndex + "]";
                if (relation.skillKey() == null || !KEY.matcher(relation.skillKey()).matches()
                    || !key.equals(relation.equipmentKey())) {
                    throw invalid(relationPath + ".skillKey", "KEY_INVALID", "装备技能关系标识不合法");
                }
                if (!skillKeys.add(relation.skillKey())) {
                    throw invalid(relationPath + ".skillKey", "DUPLICATE_KEY", "装备技能关系重复");
                }
                if (relation.skillStatus() != SkillStatus.ENABLED) {
                    throw invalid(relationPath + ".skillStatus", "SKILL_DISABLED", "装备关联技能未启用，不能返回部分装备配置");
                }
            }
            selected.add(new SelectedEquipment(item, itemAttributes, attached));
        }
        return List.copyOf(selected);
    }

    private List<SkillConfigurationResponse> selectedSkillConfigurations(String gameId, Selection choice,
                                                                        Combatant source, Combatant target) {
        Map<String, String> selectedKeys = new TreeMap<>();
        selectedKeys.put(choice.basicAttackSkillKey(), "basicAttackSkillKey");
        collectEquipmentSkillKeys(source, "source", selectedKeys);
        collectEquipmentSkillKeys(target, "target", selectedKeys);
        if (selectedKeys.size() > 32) {
            throw invalid("skillConfigurations", "CONFIGURATION_LIMIT_EXCEEDED", "所选技能配置去重后不能超过32份");
        }
        Map<String, SkillConfigurationResponse> selected = new TreeMap<>();
        Map<String, String> paths = new TreeMap<>();
        for (var entry : selectedKeys.entrySet()) {
            String path = "skillConfigurations[" + selected.size() + "]";
            SkillConfigurationResponse skill = readDependency(() -> configurations.get(gameId, entry.getKey()), entry.getValue());
            if (!entry.getKey().equals(skill.skill().skillKey())) {
                throw invalid(path + ".skill.skillKey", "KEY_INVALID", "读取的技能配置与所选技能标识不一致");
            }
            if (skill.skill().status() != SkillStatus.ENABLED) {
                throw invalid(path + ".skill.status", "SKILL_DISABLED", "所选技能未启用");
            }
            selected.put(entry.getKey(), skill);
            paths.put(entry.getKey(), path);
        }
        SkillConfigurationResponse basicAttack = selected.get(choice.basicAttackSkillKey());
        if (basicAttack.skill().maxLevel() == null || choice.basicAttackLevel() > basicAttack.skill().maxLevel()) {
            throw invalid("basicAttackLevel", "LEVEL_OUT_OF_RANGE", "普通攻击等级超过技能最高等级");
        }
        validateParameters(basicAttack, choice.basicAttackLevel(), choice.sourceLevel(), paths.get(choice.basicAttackSkillKey()));
        validateEquipmentSkillLevels(source, "source", choice.sourceLevel(), selected, paths);
        validateEquipmentSkillLevels(target, "target", choice.targetLevel(), selected, paths);
        return List.copyOf(selected.values());
    }

    private static void collectEquipmentSkillKeys(Combatant combatant, String side, Map<String, String> keys) {
        for (int equipmentIndex = 0; equipmentIndex < combatant.selectedEquipment().size(); equipmentIndex++) {
            List<EquipmentSkillRelationResponse> attached = combatant.selectedEquipment().get(equipmentIndex).attachedSkills();
            for (int relationIndex = 0; relationIndex < attached.size(); relationIndex++) {
                keys.putIfAbsent(attached.get(relationIndex).skillKey(), side + ".selectedEquipment[" + equipmentIndex
                    + "].attachedSkills[" + relationIndex + "].skillKey");
            }
        }
    }

    private void validateEquipmentSkillLevels(Combatant combatant, String side, int characterLevel,
                                             Map<String, SkillConfigurationResponse> selected, Map<String, String> paths) {
        for (int equipmentIndex = 0; equipmentIndex < combatant.selectedEquipment().size(); equipmentIndex++) {
            List<EquipmentSkillRelationResponse> attached = combatant.selectedEquipment().get(equipmentIndex).attachedSkills();
            for (int relationIndex = 0; relationIndex < attached.size(); relationIndex++) {
                String key = attached.get(relationIndex).skillKey();
                SkillConfigurationResponse skill = selected.get(key);
                if (!Integer.valueOf(1).equals(skill.skill().maxLevel())) {
                    throw invalid(side + ".selectedEquipment[" + equipmentIndex + "].attachedSkills[" + relationIndex + "].skillKey",
                        "PASSIVE_LEVEL_UNSUPPORTED", "本阶段装备技能的真实最高等级必须为1");
                }
                validateParameters(skill, 1, characterLevel, paths.get(key));
            }
        }
    }

    private static void collectEquipmentAttributeKeys(Combatant combatant, String side, Map<String, String> keys) {
        for (int equipmentIndex = 0; equipmentIndex < combatant.selectedEquipment().size(); equipmentIndex++) {
            String path = side + ".selectedEquipment[" + equipmentIndex + "].attributes.attributeValues";
            combatant.selectedEquipment().get(equipmentIndex).attributes().attributeValues().fieldNames()
                .forEachRemaining(key -> keys.putIfAbsent(key, path + "." + key));
            if (combatant.selectedEquipment().get(equipmentIndex).attributes().attributeValues().has("bonus_attack_speed_percent")) {
                keys.putIfAbsent("attack_speed", path + ".bonus_attack_speed_percent");
                keys.putIfAbsent("attack_speed_ratio", path + ".bonus_attack_speed_percent.attackSpeedRatio");
            }
        }
    }

    private static void validateEquipmentAttributes(Combatant combatant, String side, List<AttributeResponse> definitions) {
        Map<String, AttributeResponse> byKey = new TreeMap<>();
        definitions.forEach(definition -> byKey.put(definition.attributeKey(), definition));
        for (int equipmentIndex = 0; equipmentIndex < combatant.selectedEquipment().size(); equipmentIndex++) {
            String path = side + ".selectedEquipment[" + equipmentIndex + "].attributes.attributeValues";
            JsonNode values = combatant.selectedEquipment().get(equipmentIndex).attributes().attributeValues();
            for (var entry : values.properties()) {
                AttributeResponse definition = byKey.get(entry.getKey());
                BigDecimal value = entry.getValue().decimalValue();
                if (definition.valueType() == null) {
                    throw invalid(path + "." + entry.getKey(), "INVALID_STORED_DATA", "装备属性缺少数值类型");
                }
                if (definition.valueType() == AttributeValueType.INTEGER && value.stripTrailingZeros().scale() > 0) {
                    throw invalid(path + "." + entry.getKey(), "INTEGER_REQUIRED", "装备属性只允许整数");
                }
                if ((definition.minValue() != null && value.compareTo(definition.minValue()) < 0)
                    || (definition.maxValue() != null && value.compareTo(definition.maxValue()) > 0)) {
                    throw invalid(path + "." + entry.getKey(), "RANGE_INVALID", "装备属性超出目录规定的数值范围");
                }
            }
        }
    }

    private void validateParameters(SkillConfigurationResponse skill, int skillLevel, int characterLevel, String skillPath) {
        for (SkillParameterResponse parameter : skill.parameters()) {
            SkillParameterValueMode mode = parameter.valueMode();
            String path = skillPath + ".parameters." + parameter.parameterKey();
            if (mode == SkillParameterValueMode.FIXED && parameter.fixedValue() == null) {
                throw invalid(path + ".fixedValue", "NUMBER_MISSING", "固定参数没有数值");
            }
            if (mode == SkillParameterValueMode.SKILL_LEVEL
                && (parameter.levelValues() == null
                    || parameter.levelValues().get(Integer.toString(skillLevel)) == null)) {
                throw invalid(path + ".levelValues." + skillLevel,
                    "NUMBER_MISSING", "所选技能等级缺少参数数值");
            }
            if (mode == SkillParameterValueMode.CHARACTER_LEVEL
                && (parameter.levelValues() == null
                    || parameter.levelValues().get(Integer.toString(characterLevel)) == null)) {
                throw invalid(path + ".levelValues." + characterLevel,
                    "NUMBER_MISSING", "拥有方的等级缺少技能参数数值");
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

    private List<SkillObjectReferences.Reference> actualReferences(String gameId, List<SkillConfigurationResponse> skills,
                                                                  Map<String, Integer> skillIndices) {
        List<Aggregate> objects = new ArrayList<>();
        try {
            Set<Target> dictionaryAndParameters = new HashSet<>();
            for (SkillConfigurationResponse skill : skills) {
                String skillKey = skill.skill().skillKey();
                int skillIndex = skillIndices.get(skillKey);
                JsonNode data = json.valueToTree(skill);
                addAggregates(objects, data.path("formulas"), SourceType.FORMULA, "formulaKey", skillKey, skillIndex);
                addAggregates(objects, data.path("effects"), SourceType.EFFECT, "effectKey", skillKey, skillIndex);
                addAggregates(objects, data.path("internalStates"), SourceType.STATE, "stateKey", skillKey, skillIndex);
                addAggregates(objects, data.path("processes"), SourceType.PROCESS, "processKey", skillKey, skillIndex);
                addAggregates(objects, data.path("triggerRules"), SourceType.TRIGGER, "ruleKey", skillKey, skillIndex);
                for (SkillParameterResponse parameter : skill.parameters()) {
                    if (parameter.parameterKey() == null || !KEY.matcher(parameter.parameterKey()).matches()
                        || !dictionaryAndParameters.add(new Target(TargetType.PARAMETER, skillKey, parameter.parameterKey(), ""))) {
                        throw invalid("skillConfigurations[" + skillIndex + "].parameters." + parameter.parameterKey(),
                            "DUPLICATE_KEY", "参数标识缺失、不合法或重复");
                    }
                }
            }
            List<SkillObjectReferences.Reference> references = SkillObjectReferences.extract(gameId, objects);
            for (SkillObjectReferences.Reference reference : references) {
                Target dependency = reference.target();
                if ((!dependency.skillKey().isEmpty() && !skillIndices.containsKey(dependency.skillKey()))
                    || (dependency.type() == TargetType.SKILL && !skillIndices.containsKey(dependency.key()))) {
                    throw invalid(referencePath(skillIndices.get(reference.sourceSkillKey()), reference.sourceType().name(),
                        reference.sourceKey(), reference.fieldPath()), "REFERENCE_OUT_OF_SCOPE", "引用目标不在本次所选技能集合内");
                }
                if (dependency.skillKey().isEmpty()) dictionaryAndParameters.add(dependency);
            }
            SkillObjectReferences.extractAndValidate(gameId, objects, dictionaryAndParameters);
            return references.stream().distinct().sorted(Comparator.comparing(SkillObjectReferences.Reference::sourceSkillKey)
                .thenComparing(reference -> reference.sourceType().name())
                .thenComparing(SkillObjectReferences.Reference::sourceKey)
                .thenComparing(SkillObjectReferences.Reference::fieldPath)
                .thenComparing(reference -> reference.target().type().name()).thenComparing(reference -> reference.target().skillKey())
                .thenComparing(reference -> reference.target().key()).thenComparing(reference -> reference.target().subKey())).toList();
        } catch (ApiException ex) {
            if ("409.SIMULATION_SNAPSHOT_INVALID".equals(ex.getCode())) throw ex;
            List<Map<String, Object>> issues = new ArrayList<>();
            if (ex.getDetails().get("fieldIssues") instanceof List<?> original) {
                for (Object item : original) {
                    if (!(item instanceof Map<?, ?> issue)) continue;
                    Map<String, Object> translated = new LinkedHashMap<>();
                    issue.forEach((key, value) -> translated.put(key.toString(), value));
                    String field = String.valueOf(issue.get("field"));
                    int skillIndex = skillIndices.getOrDefault(String.valueOf(issue.get("sourceSkillKey")), 0);
                    translated.put("field", issue.get("sourceType") instanceof String type
                        && issue.get("sourceKey") instanceof String key
                        ? referencePath(skillIndex, type, key, field) : "skillConfigurations[" + skillIndex + "]." + field);
                    translated.put("code", "MISSING_REFERENCE_TARGET".equals(issue.get("code"))
                        ? "REFERENCE_MISSING" : "INVALID_STORED_DATA");
                    translated.put("message", ex.getMessage());
                    issues.add(translated);
                }
            }
            throw new ApiException(HttpStatus.CONFLICT, "409.SIMULATION_SNAPSHOT_INVALID", ex.getMessage(),
                Map.of("fieldIssues", List.copyOf(issues)));
        }
    }

    private void addAggregates(List<Aggregate> objects, JsonNode rows, SourceType type, String keyField,
                               String skillKey, int skillIndex) {
        Set<String> keys = new HashSet<>();
        for (JsonNode row : rows) {
            String key = row.path(keyField).asText();
            if (!KEY.matcher(key).matches() || !keys.add(key)) {
                throw invalid(referencePath(skillIndex, type.name(), key, keyField), "DUPLICATE_KEY", "对象标识缺失、不合法或重复");
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

    private static String referencePath(int skillIndex, String type, String key, String field) {
        String collection = switch (type) {
            case "FORMULA" -> "formulas";
            case "EFFECT" -> "effects";
            case "STATE" -> "internalStates";
            case "PROCESS" -> "processes";
            case "TRIGGER" -> "triggerRules";
            default -> type;
        };
        if ("TRIGGER".equals(type) && field.startsWith("limits.")) field = field.substring("limits.".length());
        return "skillConfigurations[" + skillIndex + "]." + collection + "." + key + "." + field;
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

    private static List<String> normalizeEquipmentKeys(List<String> keys, String field) {
        if (keys == null) return List.of();
        if (keys.size() > 6) {
            throw invalidEquipmentSelection("selection." + field + "[6]", "SELECTION_LIMIT_EXCEEDED", "每方所选装备不能超过6件");
        }
        Set<String> selected = new TreeSet<>();
        for (int equipmentIndex = 0; equipmentIndex < keys.size(); equipmentIndex++) {
            String key = keys.get(equipmentIndex);
            String path = "selection." + field + "[" + equipmentIndex + "]";
            if (key == null || !KEY.matcher(key).matches()) {
                throw invalidEquipmentSelection(path, "KEY_INVALID", "装备标识必须非空且格式合法");
            }
            if (!selected.add(key)) {
                throw invalidEquipmentSelection(path, "DUPLICATE_KEY", "同一方不能重复选择相同装备");
            }
        }
        return List.copyOf(selected);
    }

    private static ApiException invalidEquipmentSelection(String field, String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", message,
            Map.of("fieldIssues", List.of(Map.of("field", field, "code", code, "message", message))));
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
