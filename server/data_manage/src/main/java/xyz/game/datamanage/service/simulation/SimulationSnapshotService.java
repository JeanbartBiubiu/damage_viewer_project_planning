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
import xyz.game.datamanage.model.build.BuildConfiguration;
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
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.PlannedSkill;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SelectedEquipment;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SelectedBuild;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SkillSetting;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.service.build.BuildSystemService;
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
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class SimulationSnapshotService {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");

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
    private final BuildSystemService builds;
    private final ObjectMapper json;

    public SimulationSnapshotService(CharacterService characters, CharacterMapper characterMapper,
                                     EquipmentService equipment, EquipmentMapper equipmentMapper,
                                     SkillRelationService relations,
                                     SkillConfigurationService configurations, AttributeService attributes,
                                     SkillCategoryService categories, DamageTypeService damageTypes,
                                     ModifierZoneService zones, StatusService statuses,
                                     GameVampRuleService vampRules, BuildSystemService builds, ObjectMapper json) {
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
        this.builds = builds;
        this.json = json;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SimulationSnapshotResponse get(String gameId, Selection selection) {
        if (selection == null) throw SnapshotIssues.request("selection", "REQUIRED", "必须提供场景选择");
        SnapshotSelectionParser.parse(json.valueToTree(selection));
        Selection choice = new Selection(selection.sourceCharacterKey(), selection.sourceLevel(),
            selection.targetCharacterKey(), selection.targetLevel(), selection.basicAttackSkillKey(),
            selection.basicAttackLevel(), selection.sourceEquipmentKeys().stream().sorted().toList(),
            selection.targetEquipmentKeys().stream().sorted().toList(),
            normalizeBuilds(selection.sourceBuildConfigurations()), normalizeBuilds(selection.targetBuildConfigurations()),
            normalizeSettings(selection.sourceSkillSettings()), normalizeSettings(selection.targetSkillSettings()),
            selection.plannedSkills().stream().map(planned -> new PlannedSkill(planned.origin(), planned.skillKey(),
                planned.skillLevel(), planned.phaseKinds().stream().sorted().toList()))
                .sorted(Comparator.comparing((PlannedSkill planned) -> planned.origin().toString())
                .thenComparing(PlannedSkill::skillKey)).toList());
        LevelConfigResponse levels = characters.getLevelConfig(gameId);
        validateLevel("sourceLevel", choice.sourceLevel(), levels);
        validateLevel("targetLevel", choice.targetLevel(), levels);
        Combatant source = combatant(gameId, choice.sourceCharacterKey(), choice.sourceLevel(),
            choice.sourceEquipmentKeys(), selection.sourceBuildConfigurations(), "source");
        Combatant target = combatant(gameId, choice.targetCharacterKey(), choice.targetLevel(),
            choice.targetEquipmentKeys(), selection.targetBuildConfigurations(), "target");
        if (choice.basicAttackSkillKey() != null
            && source.attachedSkills().stream().noneMatch(relation -> choice.basicAttackSkillKey().equals(relation.skillKey()))) {
            throw invalid("source.attachedSkills", "SKILL_NOT_ATTACHED", "A 未挂载所选普通攻击");
        }
        List<SnapshotSources.Source> sources = new ArrayList<>();
        sources.addAll(SnapshotSources.collect(source, "source", choice.sourceLevel(), choice.basicAttackSkillKey(), choice.basicAttackLevel()));
        sources.addAll(SnapshotSources.collect(target, "target", choice.targetLevel(), choice.basicAttackSkillKey(), choice.basicAttackLevel()));
        sources.sort(SnapshotSources.ORDER);
        Map<String, SkillConfigurationResponse> selected = selectedSkillConfigurations(gameId, sources);
        if (choice.basicAttackSkillKey() != null
            && !selected.get(choice.basicAttackSkillKey()).skill().skillCategoryKeys().contains("basic_attack")) {
            throw invalid("basicAttackSkillKey", "BASIC_ATTACK_CATEGORY_REQUIRED", "所选真实主体必须属于普通攻击分类");
        }
        SnapshotSources.apply(sources, selection.sourceSkillSettings(), "source", choice.basicAttackSkillKey());
        SnapshotSources.apply(sources, selection.targetSkillSettings(), "target", choice.basicAttackSkillKey());
        SnapshotSources.plan(sources, selection.plannedSkills());
        SnapshotSkillClosure closure = new SnapshotSkillClosure(gameId, choice.basicAttackSkillKey(), json, sources, selected,
            (key, path) -> readSkillConfiguration(gameId, key, path));
        SnapshotSkillClosure.Result execution = closure.collect();
        List<SkillConfigurationResponse> skills = execution.configurations();
        source = withSources(source, sources, "source");
        target = withSources(target, sources, "target");
        Map<String, Integer> skillIndices = new TreeMap<>();
        for (int skillIndex = 0; skillIndex < skills.size(); skillIndex++) {
            skillIndices.put(skills.get(skillIndex).skill().skillKey(), skillIndex);
        }
        List<SkillObjectReferences.Reference> referenced = execution.references();
        Map<String, String> attributeKeys = new TreeMap<>();
        source.selectedLevelValues().fieldNames().forEachRemaining(key ->
            attributeKeys.putIfAbsent(key, "source.selectedLevelValues." + key));
        target.selectedLevelValues().fieldNames().forEachRemaining(key ->
            attributeKeys.putIfAbsent(key, "target.selectedLevelValues." + key));
        collectEquipmentAttributeKeys(source, "source", attributeKeys);
        collectEquipmentAttributeKeys(target, "target", attributeKeys);
        Map<String, String> categoryKeys = new TreeMap<>();
        Set<String> requiredCategories = new TreeSet<>();
        sources.stream().filter(item -> item.inactive == null).forEach(item -> requiredCategories.addAll(item.configuration.skill().skillCategoryKeys()));
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
                case CATEGORY -> {
                    categoryKeys.putIfAbsent(dependency.key(), path);
                    requiredCategories.add(dependency.key());
                }
                case DAMAGE_TYPE -> damageTypeKeys.putIfAbsent(dependency.key(), path);
                case MODIFIER_ZONE -> zoneKeys.putIfAbsent(dependency.key(), path);
                case STATUS -> statusKeys.putIfAbsent(dependency.key(), path);
                default -> { }
            }
            references.add(new Reference(row.sourceSkillKey(), row.sourceType().name(), row.sourceKey(),
                row.fieldPath(), dependency.type().name(), dependency.skillKey(), dependency.key(), dependency.subKey()));
        }

        for (Aggregate object : execution.objects()) {
            collectAttributeKeys(object.data(), attributeKeys, closure.objectPath(object));
        }
        if (attributeKeys.containsKey("bonus_attack_speed_percent")) {
            attributeKeys.putIfAbsent("attack_speed", attributeKeys.get("bonus_attack_speed_percent"));
            attributeKeys.putIfAbsent("attack_speed_ratio", attributeKeys.get("bonus_attack_speed_percent"));
        }
        GameVampRules vamp = vampRules.get(gameId);
        for (int ruleIndex = 0; ruleIndex < vamp.rules().size(); ruleIndex++) {
            GameVampRule rule = vamp.rules().get(ruleIndex);
            attributeKeys.putIfAbsent(rule.sourceAttributeKey(), "catalogs.vampRules.rules[" + ruleIndex + "].sourceAttributeKey");
            for (int categoryIndex = 0; categoryIndex < rule.skillCategoryKeys().size(); categoryIndex++) {
                categoryKeys.putIfAbsent(rule.skillCategoryKeys().get(categoryIndex),
                    "catalogs.vampRules.rules[" + ruleIndex + "].skillCategoryKeys[" + categoryIndex + "]");
                requiredCategories.add(rule.skillCategoryKeys().get(categoryIndex));
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
            loadCategories(gameId, categoryKeys, requiredCategories), List.copyOf(selectedDamageTypes),
            loadZones(gameId, zoneKeys), loadStatuses(gameId, statusKeys), vamp);
        SimulationSnapshotResponse content = new SimulationSnapshotResponse(gameId, choice, source, target,
            skills, catalogs, List.copyOf(references), null, null);
        return new SimulationSnapshotResponse(gameId, choice, source, target, skills, catalogs,
            List.copyOf(references), digest(content), OffsetDateTime.now(ZoneOffset.UTC));
    }

    private Combatant combatant(String gameId, String characterKey, int level, List<String> equipmentKeys,
                                List<BuildConfiguration> buildConfigurations, String side) {
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
        List<CharacterSkillRelationResponse> attached = readDependency(
            () -> relations.listCharacterRelations(gameId, characterKey, null), side + ".attachedSkills").items().stream()
            .sorted(Comparator.comparing(CharacterSkillRelationResponse::sortOrder, Comparator.nullsFirst(Comparator.naturalOrder()))
                .thenComparing(CharacterSkillRelationResponse::skillKey, Comparator.nullsFirst(Comparator.naturalOrder()))).toList();
        Set<String> bound = new HashSet<>();
        for (int index = 0; index < attached.size(); index++) {
            CharacterSkillRelationResponse relation = attached.get(index);
            String path = side + ".attachedSkills[" + index + "].skillKey";
            if (!characterKey.equals(relation.characterKey()) || !gameId.equals(relation.gameId())) {
                throw invalid(path, "REFERENCE_OUT_OF_SCOPE", "角色技能关系不属于此侧实际角色与游戏");
            }
            requireKey(path, relation.skillKey());
            if (!bound.add(relation.skillKey())) throw invalid(path, "DUPLICATE_KEY", "角色技能关系重复");
        }
        return new Combatant(character, attrs, selected.deepCopy(), List.copyOf(attached),
            selectedEquipment(gameId, equipmentKeys, side), selectedBuilds(gameId, buildConfigurations, side), List.of());
    }

    private List<SelectedBuild> selectedBuilds(String gameId, List<BuildConfiguration> selections, String side) {
        List<SelectedBuild> result = new ArrayList<>();
        for (int index = 0; index < selections.size(); index++) {
            BuildConfiguration configuration = selections.get(index);
            String path = "selection." + side + "BuildConfigurations[" + index + "]";
            var definition = readDependency(() -> builds.definition(gameId, configuration.systemKey()), path + ".systemKey");
            SnapshotBuildValidator.validate(gameId, definition, configuration, path);
            result.add(new SelectedBuild(definition, SnapshotBuildValidator.normalize(configuration)));
        }
        return result.stream().sorted(Comparator.comparing(item -> item.configuration().systemKey())).toList();
    }

    private static List<BuildConfiguration> normalizeBuilds(List<BuildConfiguration> selections) {
        return selections.stream().map(SnapshotBuildValidator::normalize).sorted(Comparator.comparing(BuildConfiguration::systemKey)).toList();
    }

    private static List<SkillSetting> normalizeSettings(List<SkillSetting> settings) {
        return settings.stream().sorted(Comparator.comparing((SkillSetting setting) -> setting.origin().toString())
            .thenComparing(SkillSetting::skillKey)).toList();
    }

    private static Combatant withSources(Combatant combatant, List<SnapshotSources.Source> sources, String side) {
        return new Combatant(combatant.character(), combatant.attributes(), combatant.selectedLevelValues(), combatant.attachedSkills(),
            combatant.selectedEquipment(), combatant.selectedBuilds(), sources.stream().filter(source -> source.side.equals(side))
                .map(SnapshotSources.Source::response).toList());
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
                    || !key.equals(relation.equipmentKey()) || !gameId.equals(relation.gameId())) {
                    throw invalid(relationPath + ".skillKey", "KEY_INVALID", "装备技能关系标识不合法");
                }
                if (!skillKeys.add(relation.skillKey())) {
                    throw invalid(relationPath + ".skillKey", "DUPLICATE_KEY", "装备技能关系重复");
                }
            }
            selected.add(new SelectedEquipment(item, itemAttributes, attached));
        }
        return List.copyOf(selected);
    }

    private Map<String, SkillConfigurationResponse> selectedSkillConfigurations(String gameId, List<SnapshotSources.Source> sources) {
        Map<String, String> selectedKeys = new TreeMap<>();
        sources.forEach(source -> selectedKeys.putIfAbsent(source.skillKey, source.path));
        if (selectedKeys.size() > 32) {
            throw invalid("skillConfigurations", "CONFIGURATION_LIMIT_EXCEEDED", "所选技能配置去重后不能超过32份");
        }
        Map<String, SkillConfigurationResponse> selected = new TreeMap<>();
        for (var entry : selectedKeys.entrySet()) {
            SkillConfigurationResponse skill = readSkillConfiguration(gameId, entry.getKey(), entry.getValue());
            selected.put(entry.getKey(), skill);
        }
        for (SnapshotSources.Source source : sources) {
            source.configuration = selected.get(source.skillKey);
            if (source.configuration.skill().status() != SkillStatus.ENABLED) source.status = source.configuration.skill().status();
        }
        return selected;
    }

    private SkillConfigurationResponse readSkillConfiguration(String gameId, String key, String path) {
        SkillConfigurationResponse skill = readDependency(() -> configurations.get(gameId, key), path);
        if (!key.equals(skill.skill().skillKey()) || !gameId.equals(skill.skill().gameId())) {
            throw invalid(path, "REFERENCE_OUT_OF_SCOPE", "读取的完整技能定义不属于实际游戏与技能身份");
        }
        return skill;
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


    private List<AttributeResponse> loadAttributes(String gameId, Map<String, String> keys) {
        List<AttributeResponse> result = new ArrayList<>();
        for (var dependency : keys.entrySet()) {
            AttributeResponse value = readDependency(() -> attributes.get(gameId, dependency.getKey()), dependency.getValue());
            requireEnabled(value.status(), dependency.getValue());
            result.add(value);
        }
        return List.copyOf(result);
    }

    private List<SkillCategoryResponse> loadCategories(String gameId, Map<String, String> keys, Set<String> required) {
        List<SkillCategoryResponse> result = new ArrayList<>();
        for (var dependency : keys.entrySet()) {
            SkillCategoryResponse value = readDependency(() -> categories.get(gameId, dependency.getKey()), dependency.getValue());
            if (required.contains(dependency.getKey())) requireEnabled(value.status(), dependency.getValue());
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
            if (ex.getStatus() == HttpStatus.CONFLICT && !"409.SIMULATION_SNAPSHOT_INVALID".equals(ex.getCode())) {
                throw invalid(field, "INVALID_STORED_DATA", ex.getMessage());
            }
            throw ex;
        } catch (IllegalStateException ex) {
            throw invalid(field, "INVALID_STORED_DATA", "所选场景引用的已存配置不合法");
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
            value.properties().stream().filter(entry -> !"readAt".equals(entry.getKey())).sorted(Map.Entry.comparingByKey())
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
