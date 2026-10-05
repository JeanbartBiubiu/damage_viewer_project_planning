package xyz.game.datamanage.service.simulation;

import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.model.attribute.*;
import xyz.game.datamanage.model.character.*;
import xyz.game.datamanage.model.equipment.*;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.model.modifierzone.*;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillcategory.*;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skilleffect.*;
import xyz.game.datamanage.model.skillinternalstate.*;
import xyz.game.datamanage.model.skillprocess.*;
import xyz.game.datamanage.model.skillrelation.*;
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

final class SimulationSnapshotFixture {
    static final String GAME = "scenario";
    static final String ATTACK = "real_attack_body";
    final CharacterService characters = mock(CharacterService.class);
    final CharacterMapper characterMapper = mock(CharacterMapper.class);
    final EquipmentService equipment = mock(EquipmentService.class);
    final EquipmentMapper equipmentMapper = mock(EquipmentMapper.class);
    final SkillRelationService relations = mock(SkillRelationService.class);
    final SkillConfigurationService configurations = mock(SkillConfigurationService.class);
    final AttributeService attributes = mock(AttributeService.class);
    final SkillCategoryService categories = mock(SkillCategoryService.class);
    final DamageTypeService damageTypes = mock(DamageTypeService.class);
    final ModifierZoneService zones = mock(ModifierZoneService.class);
    final StatusService statuses = mock(StatusService.class);
    final GameVampRuleService vampRules = mock(GameVampRuleService.class);
    final BuildSystemService builds = mock(BuildSystemService.class);
    final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    final SimulationSnapshotService service;

    SimulationSnapshotFixture() throws Exception {
        service = new SimulationSnapshotService(characters, characterMapper, equipment, equipmentMapper, relations,
            configurations, attributes, categories, damageTypes, zones, statuses, vampRules, builds, json);
        when(characters.getLevelConfig(GAME)).thenReturn(new LevelConfigResponse(GAME, 1, 18));
        for (String key : List.of("hero_a", "hero_b")) {
            String values = "{\"1\":{\"health\":100},\"2\":{\"health\":200}}";
            when(characters.get(GAME, key)).thenReturn(new CharacterResponse(GAME, key, key, null, null, null));
            when(characterMapper.findLevelValuesJson(GAME, key)).thenReturn(values);
            when(characters.getAttributes(GAME, key)).thenReturn(new CharacterAttributesResponse(key, 1, 18, json.readTree(values)));
            attach(key, ATTACK);
        }
        configuration(ATTACK, 2, "{}");
        when(categories.get(GAME, "basic_attack")).thenReturn(new SkillCategoryResponse(GAME, "basic_attack",
            "普通攻击", null, SkillCategoryStatus.ENABLED, 0, null, null));
        when(vampRules.get(GAME)).thenReturn(new GameVampRules(List.of()));
        for (String key : List.of("health", "bonus_attack_speed_percent", "attack_speed", "attack_speed_ratio")) {
            when(attributes.get(GAME, key)).thenReturn(new AttributeResponse(GAME, key, key, AttributeValueType.DECIMAL,
                BigDecimal.ZERO, null, null, AttributeStatus.ENABLED, 0, null, null));
        }
        when(zones.get(GAME, "bonus_zone")).thenReturn(new ModifierZoneResponse(GAME, "bonus_zone", "额外属性",
            ModifierZoneDomain.ATTRIBUTE, ModifierZoneCalculationMode.FLAT_ADD, ModifierZoneApplicationStage.ATTRIBUTE_FLAT,
            null, ModifierZoneStatus.ENABLED, 0, null, null));
    }

    Selection choice() {
        return new Selection("hero_a", 1, "hero_b", 2, ATTACK, 1, List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of());
    }

    SkillConfigurationResponse configuration(String key, int maximum, String additions) throws Exception {
        return configuration(key, maximum, SkillStatus.ENABLED, additions);
    }

    SkillConfigurationResponse configuration(String key, int maximum, SkillStatus status, String additions) throws Exception {
        ObjectNode body = json.createObjectNode();
        body.set("skill", json.valueToTree(new SkillResponse(GAME, key, key, null, maximum, status, 0,
            key.equals(ATTACK) ? List.of("basic_attack") : List.of(), null, null)));
        for (String field : List.of("parameters", "formulas", "effects", "processes", "internalStates", "triggerRules")) body.putArray(field);
        body.put("baseDigest", key + "-digest");
        for (var entry : json.readTree(additions).properties()) body.set(entry.getKey(), entry.getValue());
        var effectRows = body.get("effects");
        var stateRows = body.get("internalStates");
        var processRows = body.get("processes");
        body.putArray("effects");
        body.putArray("internalStates");
        body.putArray("processes");
        SkillConfigurationResponse basic = json.treeToValue(body, SkillConfigurationResponse.class);
        List<SkillEffectDetailResponse> effects = new ArrayList<>();
        for (var row : effectRows) {
            List<SkillEffectResultResponse> results = new ArrayList<>();
            for (var resultRow : row.path("results")) {
                ObjectNode resultData = resultRow.deepCopy();
                var detailData = resultData.remove("detail");
                SkillEffectResultResponse result = json.treeToValue(resultData, SkillEffectResultResponse.class);
                SkillEffectResultDetail detail = switch (result.resultType()) {
                    case DAMAGE -> json.treeToValue(detailData, SkillEffectDamageDetail.class);
                    case DIRECT_HEAL -> json.treeToValue(detailData, SkillEffectDirectHealDetail.class);
                    case ATTRIBUTE_CHANGE -> json.treeToValue(detailData, SkillEffectAttributeChangeDetail.class);
                    case RESOURCE_CHANGE -> json.treeToValue(detailData, SkillEffectResourceChangeDetail.class);
                    case COOLDOWN_CHANGE -> json.treeToValue(detailData, SkillEffectCooldownChangeDetail.class);
                    case HIT_LINK_APPLICATION -> json.treeToValue(detailData, SkillEffectHitLinkApplicationDetail.class);
                    case ATTACK_LINK_APPLICATION -> json.treeToValue(detailData, SkillEffectAttackLinkApplicationDetail.class);
                    default -> throw new IllegalArgumentException("未声明的隔离测试结果");
                };
                results.add(new SkillEffectResultResponse(result.resultKey(), result.name(), result.resultType(), result.target(),
                    result.description(), result.sortOrder(), result.valueRule(), detail, result.lifecycleBehavior(), result.spellShieldBlockScope()));
            }
            ObjectNode effectData = row.deepCopy();
            effectData.putArray("results");
            var effect = json.treeToValue(effectData, SkillEffectDetailResponse.class);
            effects.add(new SkillEffectDetailResponse(GAME, key, effect.effectKey(), effect.name(), effect.description(), effect.sortOrder(),
                effect.lifecycle(), results, effect.createdAt(), effect.updatedAt()));
        }
        List<SkillInternalStateDetailResponse> states = new ArrayList<>();
        for (var row : stateRows) {
            ObjectNode stateData = row.deepCopy();
            var detailData = stateData.remove("detail");
            var state = json.treeToValue(stateData, SkillInternalStateDetailResponse.class);
            SkillInternalStateDetail detail = switch (state.stateType()) {
                case FLAG -> json.treeToValue(detailData, SkillInternalStateFlagDetail.class);
                case COUNTER -> json.treeToValue(detailData, SkillInternalStateCounterDetail.class);
                default -> throw new IllegalArgumentException("未声明的隔离测试状态");
            };
            states.add(new SkillInternalStateDetailResponse(GAME, key, state.stateKey(), state.name(), state.stateType(), state.scope(),
                state.description(), state.sortOrder(), detail, state.createdAt(), state.updatedAt()));
        }
        List<SkillProcessDetailResponse> processes = new ArrayList<>();
        for (var row : processRows) {
            List<SkillProcessStepResponse> steps = new ArrayList<>();
            for (var stepRow : row.path("steps")) {
                ObjectNode stepData = stepRow.deepCopy();
                var detailData = stepData.remove("detail");
                var step = json.treeToValue(stepData, SkillProcessStepResponse.class);
                SkillProcessStepDetail detail = switch (step.stepType()) {
                    case IMMEDIATE -> json.treeToValue(detailData, SkillProcessImmediateStepDetail.class);
                    case DELAY -> json.treeToValue(detailData, SkillProcessDelayStepDetail.class);
                    default -> throw new IllegalArgumentException("未声明的隔离测试过程步骤");
                };
                steps.add(new SkillProcessStepResponse(step.stepKey(), step.name(), step.stepType(), step.description(), step.sortOrder(), detail));
            }
            ObjectNode processData = row.deepCopy();
            processData.putArray("steps");
            var process = json.treeToValue(processData, SkillProcessDetailResponse.class);
            processes.add(new SkillProcessDetailResponse(GAME, key, process.processKey(), process.name(), process.activationType(),
                process.description(), process.sortOrder(), process.cooldown(), steps, process.effectBindings(), process.stateOperations(),
                process.createdAt(), process.updatedAt()));
        }
        SkillConfigurationResponse result = new SkillConfigurationResponse(basic.skill(), basic.parameters(), basic.formulas(),
            effects, processes, states, basic.triggerRules(), basic.baseDigest());
        when(configurations.get(GAME, key)).thenReturn(result);
        return result;
    }

    void attach(String character, String... keys) {
        List<CharacterSkillRelationResponse> items = new ArrayList<>();
        for (int index = 0; index < keys.length; index++) items.add(new CharacterSkillRelationResponse(
            GAME, character, character, keys[index], keys[index], SkillStatus.ENABLED, index));
        when(relations.listCharacterRelations(GAME, character, null)).thenReturn(new CharacterSkillRelationListResponse(items, items.size()));
    }

    void equipment(String key, String... skills) throws Exception {
        when(equipment.get(GAME, key)).thenReturn(new EquipmentResponse(GAME, key, key, null, null, null));
        when(equipmentMapper.findAttributeValuesJson(GAME, key)).thenReturn("{\"health\":25}");
        when(equipment.getAttributes(GAME, key)).thenReturn(new EquipmentAttributesResponse(key, json.readTree("{\"health\":25}")));
        List<EquipmentSkillRelationResponse> items = new ArrayList<>();
        for (int index = 0; index < skills.length; index++) items.add(new EquipmentSkillRelationResponse(
            GAME, key, key, skills[index], skills[index], SkillStatus.ENABLED, index));
        when(relations.listEquipmentRelations(GAME, key, null)).thenReturn(new EquipmentSkillRelationListResponse(items, items.size()));
    }

    static String initialization(String key, String effect) {
        return """
            {"ruleKey":"%s","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},
             "conditionGroups":[],"actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE",
              "detail":{"effectKey":"%s"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """.formatted(key, effect);
    }

    static String heal(String key, String value) {
        return """
            {"effectKey":"%s","results":[{"resultKey":"amount","resultType":"DIRECT_HEAL","target":"SOURCE",
             "valueRule":{"value":%s,"fixedMultiplier":1},"detail":{}}]}
            """.formatted(key, value);
    }
}
