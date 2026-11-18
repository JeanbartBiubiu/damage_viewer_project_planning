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
import xyz.game.datamanage.model.build.BuildConfiguration;
import xyz.game.datamanage.model.build.BuildDefinitionResponse;
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
import xyz.game.datamanage.model.simulation.SimulationPreviewUpdate;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.service.calculation.GameCalculationRuleService;
import xyz.game.datamanage.model.calculation.GameCalculationRulesResponse;
import xyz.game.datamanage.support.authoring.GameCalculationRuleSemantics;
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
import xyz.game.datamanage.support.authoring.SkillNumericSemantics;
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
    private final GameCalculationRuleService calculationRules;
    private final BuildSystemService builds;
    private final ObjectMapper json;

    public SimulationSnapshotService(CharacterService characters, CharacterMapper characterMapper,
                                     EquipmentService equipment, EquipmentMapper equipmentMapper,
                                     SkillRelationService relations,
                                     SkillConfigurationService configurations, AttributeService attributes,
                                     SkillCategoryService categories, DamageTypeService damageTypes,
                                     ModifierZoneService zones, StatusService statuses,
                                     GameVampRuleService vampRules, GameCalculationRuleService calculationRules,
                                     BuildSystemService builds, ObjectMapper json) {
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
        this.calculationRules = calculationRules;
        this.builds = builds;
        this.json = json;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SimulationSnapshotResponse get(String gameId, Selection selection) {
        return assemble(gameId, selection, Map.of());
    }

    /** 候选投影、真实来源选择及依赖目录在同一个只读快照内装配。 */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SimulationSnapshotResponse preview(String gameId, Selection selection, List<SimulationPreviewUpdate> updates) {
        if (updates == null || updates.isEmpty() || updates.size() > 32) {
            throw invalid("updates", "PREVIEW_UPDATES_REQUIRED", "候选场景需要1至32份明确技能修改");
        }
        Map<String, SkillConfigurationResponse> overrides = new TreeMap<>();
        for (int index = 0; index < updates.size(); index++) {
            SimulationPreviewUpdate update = updates.get(index);
            if (update == null || update.skillKey() == null || !update.skillKey().matches("^[a-z][a-z0-9_]{0,63}$")
                || update.request() == null || overrides.containsKey(update.skillKey())) {
                throw invalid("updates[" + index + "]", "INVALID_PREVIEW_UPDATE", "候选修改身份或完整请求不合法，且技能不能重复");
            }
            overrides.put(update.skillKey(), configurations.previewUpdate(gameId, update.skillKey(), update.request()));
        }
        return assemble(gameId, selection, Map.copyOf(overrides));
    }

    private SimulationSnapshotResponse assemble(String gameId, Selection selection,
        Map<String, SkillConfigurationResponse> overrides) {
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
        GameCalculationRulesResponse calculation = readCalculationRules(gameId);
        String basicAttackCategoryKey = calculation.configuration().path("basicAttackCategoryKey").textValue();
        LevelConfigResponse levels = characters.getLevelConfig(gameId);
        validateLevel("sourceLevel", choice.sourceLevel(), levels);
        validateLevel("targetLevel", choice.targetLevel(), levels);
        Combatant source = combatant(gameId, choice.sourceCharacterKey(), choice.sourceLevel(),
            choice.sourceEquipmentKeys(), selection.sourceBuildConfigurations(), "source");
        Combatant target = combatant(gameId, choice.targetCharacterKey(), choice.targetLevel(),
            choice.targetEquipmentKeys(), selection.targetBuildConfigurations(), "target");
        source = projectedSkillMetadata(source, overrides);
        target = projectedSkillMetadata(target, overrides);
        if (choice.basicAttackSkillKey() != null
            && source.attachedSkills().stream().noneMatch(relation -> choice.basicAttackSkillKey().equals(relation.skillKey()))) {
            throw invalid("source.attachedSkills", "SKILL_NOT_ATTACHED", "A 未挂载所选普通攻击");
        }
        List<SnapshotSources.Source> sources = new ArrayList<>();
        sources.addAll(SnapshotSources.collect(source, "source", choice.sourceLevel(), choice.basicAttackSkillKey(), choice.basicAttackLevel()));
        sources.addAll(SnapshotSources.collect(target, "target", choice.targetLevel(), choice.basicAttackSkillKey(), choice.basicAttackLevel()));
        sources.sort(SnapshotSources.ORDER);
        Map<String, SkillConfigurationResponse> selected = selectedSkillConfigurations(gameId, sources, overrides);
        if (choice.basicAttackSkillKey() != null) {
            if (basicAttackCategoryKey == null) throw invalid("catalogs.calculationRules.configuration.basicAttackCategoryKey",
                "CATEGORY_BINDING_MISSING", "所选普通攻击需要明确绑定游戏普通攻击分类用途");
            if (!selected.get(choice.basicAttackSkillKey()).skill().skillCategoryKeys().contains(basicAttackCategoryKey)) {
                throw invalid("basicAttackSkillKey", "BASIC_ATTACK_CATEGORY_REQUIRED", "所选真实主体必须属于本次绑定的普通攻击分类");
            }
        }
        SnapshotSources.apply(sources, selection.sourceSkillSettings(), "source", choice.basicAttackSkillKey());
        SnapshotSources.apply(sources, selection.targetSkillSettings(), "target", choice.basicAttackSkillKey());
        SnapshotSources.plan(sources, selection.plannedSkills());
        SnapshotSkillClosure closure = new SnapshotSkillClosure(gameId, choice.basicAttackSkillKey(), basicAttackCategoryKey, json, sources, selected,
            (key, path) -> readSkillConfiguration(gameId, key, path, overrides));
        SnapshotSkillClosure.Result execution = closure.collect();
        Set<String> neededSkillKeys = execution.objects().stream().map(Aggregate::skillKey).collect(java.util.stream.Collectors.toSet());
        for (String key : overrides.keySet()) if (!neededSkillKeys.contains(key)) {
            throw invalid("updates." + key, "PREVIEW_UPDATE_NOT_CONSUMED", "候选技能不在本场装配所需范围内");
        }
        List<SkillConfigurationResponse> skills = execution.configurations();
        source = withSources(source, sources, "source");
        target = withSources(target, sources, "target");
        Map<String, Integer> skillIndices = new TreeMap<>();
        for (int skillIndex = 0; skillIndex < skills.size(); skillIndex++) {
            skillIndices.put(skills.get(skillIndex).skill().skillKey(), skillIndex);
        }
        List<SkillObjectReferences.Reference> referenced = execution.references();
        Map<String, String> attributeKeys = new TreeMap<>(GameCalculationRuleSemantics.dependencies(calculation.configuration()));
        source.selectedLevelValues().fieldNames().forEachRemaining(key ->
            attributeKeys.putIfAbsent(key, "source.selectedLevelValues." + key));
        target.selectedLevelValues().fieldNames().forEachRemaining(key ->
            attributeKeys.putIfAbsent(key, "target.selectedLevelValues." + key));
        collectEquipmentAttributeKeys(source, "source", attributeKeys);
        collectEquipmentAttributeKeys(target, "target", attributeKeys);
        Map<String, String> categoryKeys = new TreeMap<>(GameCalculationRuleSemantics.categoryDependencies(calculation.configuration()));
        Set<String> requiredCategories = new TreeSet<>(categoryKeys.keySet());
        sources.stream().filter(item -> item.inactive == null).forEach(item -> requiredCategories.addAll(item.configuration.skill().skillCategoryKeys()));
        for (int skillIndex = 0; skillIndex < skills.size(); skillIndex++) {
            SkillConfigurationResponse skill = skills.get(skillIndex);
            // 快照运输完整作者定义；未执行公式的全部属性声明同样需要真实目录授权。
            for (int formulaIndex = 0; formulaIndex < skill.formulas().size(); formulaIndex++) {
                collectAttributeKeys(skill.formulas().get(formulaIndex).expression(), attributeKeys,
                    "skillConfigurations[" + skillIndex + "].formulas[" + formulaIndex + "].expression");
            }
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
        Set<String> executionDamageTypeKeys = Set.copyOf(damageTypeKeys.keySet());
        for (SkillObjectReferences.Reference row : closure.definitionDamageTypeReferences()) {
            damageTypeKeys.putIfAbsent(row.target().key(), referencePath(skillIndices.get(row.sourceSkillKey()),
                row.sourceType().name(), row.sourceKey(), row.fieldPath()));
        }
        // 仅新封顶点数需要以真实结算公式证明BONUS抗性；新增目录不构成伤害生产者或执行引用。
        boolean capDefenseDefinitions = cappedDefenseDefinitionsRequired(execution.objects(), closure.definitions());
        if (capDefenseDefinitions) {
            var directory = damageTypes.list(gameId, new xyz.game.datamanage.model.damagetype.DamageTypeListQuery(null, "ENABLED"));
            Set<String> seen = new HashSet<>();
            if (directory == null || directory.items() == null) throw invalid("catalogs.damageTypes", "REFERENCE_MISSING", "封顶点数缺少真实启用伤害目录");
            for (DamageTypeResponse type : directory.items()) {
                if (!gameId.equals(type.gameId()) || !KEY.matcher(type.damageTypeKey()).matches() || !seen.add(type.damageTypeKey()))
                    throw invalid("catalogs.damageTypes", "REFERENCE_OUT_OF_SCOPE", "抗性证明的伤害目录身份缺失或重复");
                requireEnabled(type.status(), "catalogs.damageTypes." + type.damageTypeKey());
                damageTypeKeys.putIfAbsent(type.damageTypeKey(), "catalogs.damageTypes." + type.damageTypeKey());
            }
        }

        for (Aggregate object : execution.objects()) {
            collectAttributeKeys(object.data(), attributeKeys, closure.objectPath(object));
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
                throw invalid("catalogs.damageTypes." + key + ".formula", "FORMULA_MISSING", "伤害类型缺少共同结算公式");
            }
            DamageTypeFormulaResponse formula = readDependency(() -> damageTypes.getFormula(gameId, key),
                "catalogs.damageTypes." + key + ".formula");
            if (!gameId.equals(type.gameId()) || !key.equals(type.damageTypeKey())
                || !gameId.equals(formula.gameId()) || !key.equals(formula.damageTypeKey())) {
                throw invalid("catalogs.damageTypes." + key, "REFERENCE_OUT_OF_SCOPE", "伤害类型定义不属于当前游戏与目录身份");
            }
            String formulaPath = "catalogs.damageTypes." + key + ".formula";
            if (formula.formula() == null) throw invalid(formulaPath, "FORMULA_MISSING", "伤害类型缺少共同结算公式");
            var structuralIssue = xyz.game.datamanage.support.formula.FormulaContractValidator.validate(formula.formula(),
                xyz.game.datamanage.support.formula.DamageTypeFormulaBindings.allowed(
                    xyz.game.datamanage.support.formula.DamageTypeFormulaBindings.attributeKeys(formula.formula())));
            if (structuralIssue != null) throw invalid(formulaPath + structuralIssue.path(), structuralIssue.code(), "伤害类型共同公式损坏");
            var dependencies = SkillObjectReferences.extract(gameId, List.of(new Aggregate(
                SkillObjectReferences.SourceType.DAMAGE_TYPE, "", key,
                json.createObjectNode().set("formula", formula.formula()))));
            for (var row : dependencies) {
                attributeKeys.putIfAbsent(row.target().key(), formulaPath + "/" + row.fieldPath());
                if (executionDamageTypeKeys.contains(key))
                    references.add(new Reference("", "DAMAGE_TYPE", key, row.fieldPath(), "ATTRIBUTE", "", row.target().key(), ""));
            }
            selectedDamageTypes.add(new DamageTypeEntry(type, formula));
        }
        List<AttributeResponse> selectedAttributes = loadAttributes(gameId, attributeKeys);
        Map<String, GameCalculationRuleSemantics.Attribute> calculationAttributes = new LinkedHashMap<>();
        selectedAttributes.forEach(attribute -> calculationAttributes.put(attribute.attributeKey(),
            new GameCalculationRuleSemantics.Attribute(attribute.valueType() == null ? null : attribute.valueType().name(), attribute.status().name())));
        List<SkillCategoryResponse> selectedCategories = loadCategories(gameId, categoryKeys, requiredCategories);
        Map<String, GameCalculationRuleSemantics.Category> calculationCategories = new LinkedHashMap<>();
        selectedCategories.forEach(category -> calculationCategories.put(category.skillCategoryKey(),
            new GameCalculationRuleSemantics.Category(category.status().name())));
        var calculationIssue = GameCalculationRuleSemantics.validate(calculation.configuration(), calculationAttributes, calculationCategories);
        if (calculationIssue != null) throw invalid("catalogs.calculationRules" + calculationIssue.field(), calculationIssue.code(), calculationIssue.message());
        for (DamageTypeEntry entry : selectedDamageTypes) {
            var issue = xyz.game.datamanage.support.formula.FormulaContractValidator.validate(entry.formula().formula(),
                xyz.game.datamanage.support.formula.DamageTypeFormulaBindings.allowed(
                    selectedAttributes.stream().map(AttributeResponse::attributeKey).toList()));
            if (issue != null) throw invalid("catalogs.damageTypes." + entry.type().damageTypeKey() + ".formula" + issue.path(),
                issue.code(), "伤害类型共同公式结构或授权绑定不合法");
        }
        for (Aggregate object : execution.objects()) {
            if (object.type() != SkillObjectReferences.SourceType.FORMULA) continue;
            var owner = skills.stream().filter(configuration -> configuration.skill().skillKey().equals(object.skillKey())).findFirst().orElseThrow();
            var issue = xyz.game.datamanage.support.formula.FormulaContractValidator.validate(object.data().path("expression"),
                xyz.game.datamanage.support.formula.SkillFormulaBindings.allowed(object.skillKey(),
                    selectedAttributes.stream().map(AttributeResponse::attributeKey).toList(),
                    owner.parameters().stream().map(parameter -> parameter.parameterKey()).toList()));
            if (issue != null) throw invalid(closure.objectPath(object) + "/expression" + issue.path(), issue.code(), "场景必要技能公式授权不合法");
        }        validateEquipmentAttributes(source, "source", selectedAttributes);
        validateEquipmentAttributes(target, "target", selectedAttributes);
        List<ModifierZoneResponse> selectedZones = loadZones(gameId, zoneKeys);
        validateCappedDamageModifiers(execution.objects(), closure.definitions(), skills, selectedZones, selectedDamageTypes, selectedAttributes);
        Catalogs catalogs = new Catalogs(levels, selectedAttributes,
            selectedCategories, List.copyOf(selectedDamageTypes),
            selectedZones, loadStatuses(gameId, statusKeys), vamp, calculation);
        List<String> executionSkillKeys = execution.executionSkillKeys();
        SimulationSnapshotResponse content = new SimulationSnapshotResponse(gameId, choice, source, target,
            skills, executionSkillKeys, catalogs, List.copyOf(references), null, null);
        return new SimulationSnapshotResponse(gameId, choice, source, target, skills, executionSkillKeys, catalogs,
            List.copyOf(references), digest(content), OffsetDateTime.now(ZoneOffset.UTC));
    }

    private static boolean cappedDefenseDefinitionsRequired(List<Aggregate> execution, List<Aggregate> definitions) {
        Set<String> formulas = new HashSet<>();
        for (Aggregate effect : execution) if (effect.type() == SkillObjectReferences.SourceType.EFFECT) {
            for (JsonNode result : effect.data().path("results")) if (result.path("detail").has("maximumReductionRatioValue")
                && "FORMULA".equals(result.path("valueRule").path("value").path("kind").asText()))
                formulas.add(effect.skillKey() + "/" + result.path("valueRule").path("value").path("formulaKey").asText());
        }
        return definitions.stream().anyMatch(formula -> formula.type() == SkillObjectReferences.SourceType.FORMULA
            && formulas.contains(formula.skillKey() + "/" + formula.key())
            && formula.data().path("expression").path("inputs").valueStream().anyMatch(input -> "attribute".equals(input.path("binding").path("kind").asText())));
    }

    private void validateCappedDamageModifiers(List<Aggregate> execution, List<Aggregate> definitions, List<SkillConfigurationResponse> skills,
        List<ModifierZoneResponse> zones, List<DamageTypeEntry> types, List<AttributeResponse> attributes) {
        Map<String, String> modes = new LinkedHashMap<>(), domains = new LinkedHashMap<>(), stages = new LinkedHashMap<>();
        for (ModifierZoneResponse zone : zones) {
            modes.put(zone.modifierZoneKey(), zone.calculationMode().name());
            domains.put(zone.modifierZoneKey(), zone.domain().name());
            stages.put(zone.modifierZoneKey(), zone.applicationStage().name());
        }
        List<Aggregate> context = new ArrayList<>(definitions);
        for (DamageTypeEntry type : types) context.add(new Aggregate(SkillObjectReferences.SourceType.DAMAGE_TYPE, "", type.type().damageTypeKey(),
            json.createObjectNode().put("status", type.type().status().name()).set("formula", type.formula().formula())));
        List<SkillNumericSemantics.Parameter> parameters = new ArrayList<>();
        for (SkillConfigurationResponse skill : skills) for (var parameter : skill.parameters()) parameters.add(new SkillNumericSemantics.Parameter(
            skill.skill().skillKey(), parameter.parameterKey(), parameter.valueType() == null ? null : parameter.valueType().name(),
            parameter.valueMode() == null ? null : parameter.valueMode().name(), parameter.fixedValue(), json.valueToTree(parameter.levelValues()), skill.skill().maxLevel()));
        try {
            SkillNumericSemantics.validateCappedDamageModifiers(execution, context, parameters, modes, domains, stages,
                attributes.stream().map(AttributeResponse::attributeKey).collect(java.util.stream.Collectors.toSet()));
            SkillNumericSemantics.validateGroupedAmplification(execution, context, parameters, modes, domains, stages);
        } catch (ApiException error) {
            throw new ApiException(HttpStatus.CONFLICT, "409.SIMULATION_SNAPSHOT_INVALID", "场景数值修正的完整来源或数值声明不合法", error.getDetails());
        }
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

    /** 关系身份来自实际数据库；仅将关联查询中的技能名称与状态同步为本次投影值。 */
    private static Combatant projectedSkillMetadata(Combatant actor, Map<String, SkillConfigurationResponse> overrides) {
        if (overrides.isEmpty()) return actor;
        List<CharacterSkillRelationResponse> attached = actor.attachedSkills().stream().map(row -> {
            var candidate = overrides.get(row.skillKey());
            return candidate == null ? row : new CharacterSkillRelationResponse(row.gameId(), row.characterKey(), row.characterName(),
                row.skillKey(), candidate.skill().name(), candidate.skill().status(), row.sortOrder());
        }).toList();
        List<SelectedEquipment> items = actor.selectedEquipment().stream().map(item -> new SelectedEquipment(item.equipment(), item.attributes(),
            item.attachedSkills().stream().map(row -> {
                var candidate = overrides.get(row.skillKey());
                return candidate == null ? row : new EquipmentSkillRelationResponse(row.gameId(), row.equipmentKey(), row.equipmentName(),
                    row.skillKey(), candidate.skill().name(), candidate.skill().status(), row.sortOrder());
            }).toList())).toList();
        List<SelectedBuild> builds = actor.selectedBuilds().stream().map(build -> {
            var definition = build.definition();
            var relations = definition.skillRelations().stream().map(row -> {
                var candidate = overrides.get(row.skillKey());
                return candidate == null ? row : new BuildOptionSkillRelationResponse(row.gameId(), row.systemKey(), row.optionKey(),
                    row.optionName(), row.skillKey(), candidate.skill().name(), candidate.skill().status(), row.activationRank(),
                    row.skillLevelMode(), row.fixedSkillLevel(), row.sortOrder());
            }).toList();
            return new SelectedBuild(new BuildDefinitionResponse(definition.system(), definition.groups(), definition.options(), relations), build.configuration());
        }).toList();
        return new Combatant(actor.character(), actor.attributes(), actor.selectedLevelValues(), attached, items, builds, actor.skillSources());
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

    private Map<String, SkillConfigurationResponse> selectedSkillConfigurations(String gameId, List<SnapshotSources.Source> sources,
        Map<String, SkillConfigurationResponse> overrides) {
        Map<String, String> selectedKeys = new TreeMap<>();
        sources.forEach(source -> selectedKeys.putIfAbsent(source.skillKey, source.path));
        if (selectedKeys.size() > 32) {
            throw invalid("skillConfigurations", "CONFIGURATION_LIMIT_EXCEEDED", "所选技能配置去重后不能超过32份");
        }
        Map<String, SkillConfigurationResponse> selected = new TreeMap<>();
        for (var entry : selectedKeys.entrySet()) {
            SkillConfigurationResponse skill = readSkillConfiguration(gameId, entry.getKey(), entry.getValue(), overrides);
            selected.put(entry.getKey(), skill);
        }
        for (SnapshotSources.Source source : sources) {
            source.configuration = selected.get(source.skillKey);
            if (source.configuration.skill().status() != SkillStatus.ENABLED) source.status = source.configuration.skill().status();
        }
        return selected;
    }

    private SkillConfigurationResponse readSkillConfiguration(String gameId, String key, String path,
        Map<String, SkillConfigurationResponse> overrides) {
        SkillConfigurationResponse skill = overrides.containsKey(key) ? overrides.get(key)
            : readDependency(() -> configurations.get(gameId, key), path);
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
            if (!gameId.equals(value.gameId()) || !dependency.getKey().equals(value.attributeKey())) {
                throw invalid(dependency.getValue(), "REFERENCE_OUT_OF_SCOPE", "属性不属于当前游戏与目录身份");
            }
            result.add(value);
        }
        return List.copyOf(result);
    }

    private List<SkillCategoryResponse> loadCategories(String gameId, Map<String, String> keys, Set<String> required) {
        List<SkillCategoryResponse> result = new ArrayList<>();
        for (var dependency : keys.entrySet()) {
            SkillCategoryResponse value = readDependency(() -> categories.get(gameId, dependency.getKey()), dependency.getValue());
            if (required.contains(dependency.getKey())) requireEnabled(value.status(), dependency.getValue());
            if (!gameId.equals(value.gameId()) || !dependency.getKey().equals(value.skillCategoryKey())) {
                throw invalid(dependency.getValue(), "REFERENCE_OUT_OF_SCOPE", "分类不属于当前游戏与目录身份");
            }
            result.add(value);
        }
        return List.copyOf(result);
    }

    private List<ModifierZoneResponse> loadZones(String gameId, Map<String, String> keys) {
        List<ModifierZoneResponse> result = new ArrayList<>();
        for (var dependency : keys.entrySet()) {
            ModifierZoneResponse value = readDependency(() -> zones.get(gameId, dependency.getKey()), dependency.getValue());
            if (!gameId.equals(value.gameId()) || !dependency.getKey().equals(value.modifierZoneKey())) {
                throw invalid(dependency.getValue(), "REFERENCE_TYPE_MISMATCH", "乘区回读的游戏归属或标识不一致");
            }
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
            node.properties().forEach(entry -> collectAttributeKeys(entry.getValue(), keys, path + "." + entry.getKey()));
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                collectAttributeKeys(node.get(i), keys, path + "[" + i + "]");
            }
        }
    }

    private GameCalculationRulesResponse readCalculationRules(String gameId) {
        GameCalculationRulesResponse response = readDependency(() -> calculationRules.get(gameId), "catalogs.calculationRules");
        if (response == null || response.configuration() == null || response.configuration().isNull()) {
            throw invalid("catalogs.calculationRules.configuration", "CONFIGURATION_MISSING", "游戏计算配置尚未明确保存");
        }
        if (!gameId.equals(response.gameId()) || response.baseDigest() == null || !response.baseDigest().matches("[0-9a-f]{64}")) {
            throw invalid("catalogs.calculationRules", "REFERENCE_OUT_OF_SCOPE", "游戏计算配置身份或摘要损坏");
        }
        Map<String, String> dependencies = GameCalculationRuleSemantics.dependencies(response.configuration());
        Map<String, GameCalculationRuleSemantics.Attribute> structuralDirectory = new LinkedHashMap<>();
        dependencies.keySet().forEach(key -> structuralDirectory.put(key, new GameCalculationRuleSemantics.Attribute("DECIMAL", "ENABLED")));
        Map<String, GameCalculationRuleSemantics.Category> structuralCategories = new LinkedHashMap<>();
        GameCalculationRuleSemantics.categoryDependencies(response.configuration()).keySet().forEach(key ->
            structuralCategories.put(key, new GameCalculationRuleSemantics.Category("ENABLED")));
        var issue = GameCalculationRuleSemantics.validate(response.configuration(), structuralDirectory, structuralCategories);
        if (issue != null) throw invalid("catalogs.calculationRules" + issue.field(), issue.code(), issue.message());
        return response;
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
