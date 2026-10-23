package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeStatus;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures;

class SimulationSnapshotDormantRawDamageMarkTest {
    private static final String PASSIVE = "passive_program";
    private static final String BURST = "burst_spell";
    private static final String AREA = "pulse_spell";
    // Frozen graph uses the enabled LoL real-damage key; identities are rebound below.
    private static final String FROZEN_EXPECTED = """
        {"baseDigest":"43dd8835a6c1908644d34b1e03f9255a7eb0d1aa43da233250cb4f9af12950d5","effects":[{"gameId":"lol","skillKey":"amumu_p","effectKey":"curse_true_damage","name":"诅咒额外真实伤害","description":"单真实父魔伤事件的原额乘原比例；不建独立法盾命中单元，不混写状态。","sortOrder":10,"lifecycle":null,"results":[{"resultKey":"damage","name":"诅咒真伤","description":"明确直接技能伤害分类，与当前已保存R本体同为SKILL/DIRECT/RESOLVED且无局部吸血覆盖；不取得普通攻击主体资格，不声称复杂proc继承。","sortOrder":10,"resultType":"DAMAGE","target":"TARGET","lifecycleBehavior":null,"spellShieldBlockScope":null,"valueRule":{"value":{"kind":"FORMULA","formulaKey":"bonus_true_damage"},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},"detail":{"damageTypeKey":"real","deliveryKind":"SKILL","originKind":"DIRECT","critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"RESOLVED","vampOverrides":[]}}]}],"formulas":[{"createdAt":"2026-09-09T14:32:17.548231Z","description":"当前根绑定没有直接事件树；仅按正文比例计算额外真实伤害。魔法伤害基准的减伤阶段是待补语义，公式不代表已接线事件。","expression":{"inputs":[{"key":"input_0","binding":{"kind":"parameter","skillKey":"amumu_p","parameterKey":"magic_damage_bonus_true_ratio"}},{"key":"input_1","binding":{"kind":"parameter","skillKey":"amumu_p","parameterKey":"magic_damage_base"}}],"stages":[{"key":"output","name":"原技能公式输出","expression":{"op":"mul","args":[{"op":"read","inputKey":"input_0"},{"op":"read","inputKey":"input_1"}]}}],"outputStageKey":"output"},"formulaKey":"bonus_true_damage","gameId":"lol","name":"额外真实伤害量","skillKey":"amumu_p","sortOrder":10,"updatedAt":"2026-10-08T18:16:38.52499Z"}],"internalStates":[{"gameId":"lol","skillKey":"amumu_p","stateKey":"curse","name":"本来源诅咒","description":"目标独立0/1计数；正写按当前时刻刷新为原curse_duration_ms，到期精确归0；不导入战前标记。","sortOrder":10,"scope":"TARGET","stateType":"COUNTER","detail":{"initialValue":{"kind":"FIXED","value":0},"maxValue":{"kind":"FIXED","value":1},"durationValue":{"kind":"PARAMETER","parameterKey":"curse_duration_ms"}}}],"parameters":[{"createdAt":"2026-09-09T14:32:14.035319Z","description":"客户端根绑定 DataValues.DebuffDuration 原始数组索引1取3秒，按毫秒录入；只记录诅咒持续，不创建诅咒事件。","fixedValue":3000,"gameId":"lol","levelValues":null,"name":"诅咒持续（毫秒）","parameterKey":"curse_duration_ms","skillKey":"amumu_p","sortOrder":10,"updatedAt":"2026-09-09T14:32:14.035319Z","valueMode":"FIXED","valueType":"INTEGER"},{"createdAt":"2026-09-09T14:32:16.466102Z","description":"当前根正文只证明额外真实伤害按魔法伤害计算；该基准处于魔法减伤前还是减伤后尚未证实，不设置默认值。","fixedValue":null,"gameId":"lol","levelValues":null,"name":"魔法伤害基准（所处减伤阶段待补）","parameterKey":"magic_damage_base","skillKey":"amumu_p","sortOrder":30,"updatedAt":"2026-09-09T14:32:16.466102Z","valueMode":"RUNTIME_INPUT","valueType":"DECIMAL"},{"createdAt":"2026-09-09T14:32:15.333618Z","description":"客户端根绑定 DataValues.DamageAmp 原始数组索引1取0.1；正文显示为10%，本参数用比例0.1。","fixedValue":0.1,"gameId":"lol","levelValues":null,"name":"额外真实伤害比例","parameterKey":"magic_damage_bonus_true_ratio","skillKey":"amumu_p","sortOrder":20,"updatedAt":"2026-09-09T14:32:15.333618Z","valueMode":"FIXED","valueType":"DECIMAL"}],"processes":[{"gameId":"lol","skillKey":"amumu_p","processKey":"apply_curse","name":"施加或刷新诅咒","description":"只消费真实已核资格，单步SET1；不产生伤害，不占行动，不另造主动使用。","sortOrder":10,"activationType":"PASSIVE","cooldown":null,"steps":[{"stepKey":"mark","name":"诅咒置1","description":null,"sortOrder":10,"stepType":"IMMEDIATE","occupiesAction":false,"detail":{}}],"effectBindings":[],"stateOperations":[{"operationKey":"set_curse","name":"本目标诅咒置1","stateSkillKey":"amumu_p","stateKey":"curse","operation":"SET","value":{"kind":"FIXED","value":1},"optionKey":null,"moment":{"momentType":"STEP_EXECUTION","stepKey":"mark"},"sortOrder":10}]}],"skill":{"createdAt":"2026-09-06T18:16:22.321486Z","description":"普攻实际物理主体的伤害事件施加或刷新本来源目标诅咒3000毫秒；R实际未阻挡命中在本体伤害之后施加或刷新。目标在本笔伤害之前已有本来源诅咒时，本来源原始魔法伤害另产生10%直接真实伤害；真实W魔伤只刷新已有诅咒。普攻主体唯一性和候选提交顺序必须由最终完整编译图证明。普通法力费用忽略，未模拟空间或复杂命中特效继承；本候选尚未保存、编译或运行。","gameId":"lol","maxLevel":1,"name":"阿木木·诅咒之触","skillCategoryKeys":["passive"],"skillKey":"amumu_p","sortOrder":0,"status":"ENABLED","updatedAt":"2026-09-06T18:16:22.321486Z"},"triggerRules":[{"ruleKey":"derive_true_on_marked_magic","name":"已有诅咒的本来源魔伤派生真伤","description":"仅本拥有者真实魔法伤害逐笔事件，伤前标记1；绑定原RAW_DAMAGE，无默认值。真伤与魔法过滤互斥，单动作不写状态。","sortOrder":30,"eventSource":{"eventType":"DAMAGE_DEALT","detail":{"sourceSkillKey":null,"damageTypeKey":"magic","deliveryKind":"ANY","originKind":"ANY"}},"conditionGroups":[{"groupKey":"qualified","name":"本笔真实事件资格","sortOrder":10,"conditions":[{"conditionKey":"curse_before_damage","conditionType":"INTERNAL_STATE_CHECK","sortOrder":10,"detail":{"stateSkillKey":"amumu_p","stateKey":"curse","valueKind":"DAMAGE_BEFORE_VALUE","optionKey":null,"expectedBoolean":null,"comparator":"EQ","comparisonValue":{"kind":"FIXED","value":1}}}]}],"actions":[{"actionKey":"derive_true_damage","name":"本笔原额派生真伤","sortOrder":10,"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"curse_true_damage"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[{"bindingKey":"raw_magic_damage","parameterKey":"magic_damage_base","sourceType":"EVENT_VALUE","detail":{"eventValueKey":"RAW_DAMAGE"}}],"resultModifiers":[]}],"perTargetCooldown":null,"maxTriggersPerProcess":null,"oncePerUse":null},{"ruleKey":"mark_on_primary_attack","name":"真实普攻物理主体挂诅咒","description":"作者只筛所选共享普攻的物理BASIC_ATTACK/DIRECT；伤前GTE0要求真实父伤害冻结，包括有效0伤害。最终完整编译图另证唯一独立PRIMARY及它早于后续魔伤；无作者op筛选字段。","sortOrder":10,"eventSource":{"eventType":"DAMAGE_DEALT","detail":{"sourceSkillKey":"shared_basic_attack","damageTypeKey":"physics","deliveryKind":"BASIC_ATTACK","originKind":"DIRECT"}},"conditionGroups":[{"groupKey":"qualified","name":"本笔真实事件资格","sortOrder":10,"conditions":[{"conditionKey":"curse_before_damage","conditionType":"INTERNAL_STATE_CHECK","sortOrder":10,"detail":{"stateSkillKey":"amumu_p","stateKey":"curse","valueKind":"DAMAGE_BEFORE_VALUE","optionKey":null,"expectedBoolean":null,"comparator":"GTE","comparisonValue":{"kind":"FIXED","value":0}}}]}],"actions":[{"actionKey":"mark","name":"施加或刷新本来源诅咒","sortOrder":10,"actionType":"START_PROCESS","detail":{"processKey":"apply_curse"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}],"perTargetCooldown":null,"maxTriggersPerProcess":null,"oncePerUse":null},{"ruleKey":"mark_on_unblocked_r","name":"R伤害之后未阻挡命中挂诅咒","description":"仅消费真实R命中在本体伤害候选之后的事件；明确法盾阻挡事实0，首次接触计数不代替未阻挡。","sortOrder":20,"eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"amumu_r"}},"conditionGroups":[{"groupKey":"qualified","name":"本笔真实事件资格","sortOrder":10,"conditions":[{"conditionKey":"enemy_target","conditionType":"SKILL_HIT_TARGET_IS_ENEMY","sortOrder":10,"detail":{}},{"conditionKey":"not_spell_shield_blocked","conditionType":"EVENT_VALUE_COMPARE","sortOrder":20,"detail":{"eventValueKey":"SKILL_HIT_SPELL_SHIELD_BLOCKED","comparator":"EQ","comparisonValue":{"kind":"FIXED","value":0}}}]}],"actions":[{"actionKey":"mark","name":"施加或刷新本来源诅咒","sortOrder":10,"actionType":"START_PROCESS","detail":{"processKey":"apply_curse"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}],"perTargetCooldown":null,"maxTriggersPerProcess":null,"oncePerUse":null},{"ruleKey":"refresh_on_marked_w","name":"W魔伤刷新已有诅咒","description":"真实W魔法SKILL伤害逐笔事件，伤前标记1才续期；不因W新建标记。与派生规则各读同笔冻结事实，不依赖两监听先后。","sortOrder":40,"eventSource":{"eventType":"DAMAGE_DEALT","detail":{"sourceSkillKey":"amumu_w","damageTypeKey":"magic","deliveryKind":"SKILL","originKind":"ANY"}},"conditionGroups":[{"groupKey":"qualified","name":"本笔真实事件资格","sortOrder":10,"conditions":[{"conditionKey":"curse_before_damage","conditionType":"INTERNAL_STATE_CHECK","sortOrder":10,"detail":{"stateSkillKey":"amumu_p","stateKey":"curse","valueKind":"DAMAGE_BEFORE_VALUE","optionKey":null,"expectedBoolean":null,"comparator":"EQ","comparisonValue":{"kind":"FIXED","value":1}}}]}],"actions":[{"actionKey":"mark","name":"施加或刷新本来源诅咒","sortOrder":10,"actionType":"START_PROCESS","detail":{"processKey":"apply_curse"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}],"perTargetCooldown":null,"maxTriggersPerProcess":null,"oncePerUse":null}]}
        """;
    private SimulationSnapshotFixture fixture;
    private ObjectNode graph;

    @BeforeEach
    void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_b", ATTACK, PASSIVE, BURST, AREA);
        fixture.configuration(BURST, 1, "{}");
        fixture.configuration(AREA, 1, "{}");
        graph = (ObjectNode) fixture.json.readTree(FROZEN_EXPECTED);
        rebind(graph);
        graph.remove(List.of("skill", "baseDigest"));
        install();
        damageCatalogs();
    }

    @Test
    void frozenCompleteTargetGraphIsDefinitionOnlyWithoutExecutableRootsOrInputs() {
        var result = fixture.service.get(GAME, selection(true, 1));
        var passive = result.target().skillSources().stream().filter(row -> row.skillKey().equals(PASSIVE)).findFirst().orElseThrow();
        assertTrue(passive.enabled());
        assertEquals(1, passive.skillLevel());
        assertEquals(InactiveReason.NO_REACHABLE_EVENT, passive.inactiveReason());
        assertEquals(List.of(), passive.enabledRuleKeys());
        assertTrue(result.references().stream().noneMatch(row -> row.sourceSkillKey().equals(PASSIVE)));
        assertEquals(1, result.skillConfigurations().stream().filter(row -> row.skill().skillKey().equals(PASSIVE)).count());
        assertCompleteDamageCatalogs(result);
        for (String key : List.of("magic", "physics", "real")) {
            verify(fixture.damageTypes).get(GAME, key);
            verify(fixture.damageTypes).getFormula(GAME, key);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"writer", "action", "state", "live_value", "raw_default", "shield", "formula_branch", "negative_ratio",
        "zero_duration", "fractional_duration", "missing_duration", "empty_action", "blocked_one", "wrong_w_before", "foreign_state", "delivery", "missing_target", "synthetic_true_damage"})
    void incompleteOrMixedRawGraphCannotFallBackToGenericDeferred(String mutation) throws Exception {
        switch (mutation) {
            case "writer" -> {
                ObjectNode operation = (ObjectNode) graph.path("processes").get(0).path("stateOperations").get(0).deepCopy();
                operation.put("operationKey", "extra_writer"); ((ArrayNode) graph.path("processes").get(0).path("stateOperations")).add(operation);
            }
            case "action" -> {
                ObjectNode action = (ObjectNode) rule("mark_on_primary_attack").path("actions").get(0).deepCopy();
                action.put("actionKey", "extra_action"); ((ArrayNode) rule("mark_on_primary_attack").path("actions")).add(action);
            }
            case "state" -> {
                ObjectNode state = (ObjectNode) graph.path("internalStates").get(0).deepCopy(); state.put("stateKey", "extra_state");
                ((ArrayNode) graph.path("internalStates")).add(state);
            }
            case "live_value" -> stateCheck("derive_true_on_marked_magic").put("valueKind", "VALUE");
            case "raw_default" -> parameter("magic_damage_base").put("fixedValue", 0);
            case "shield" -> ((ObjectNode) graph.path("effects").get(0).path("results").get(0)).put("spellShieldBlockScope", "SKILL");
            case "formula_branch" -> ((ArrayNode) graph.path("formulas").get(0).path("expression").path("stages")).addObject()
                .put("key", "unused").set("expression", fixture.json.readTree("{\"op\":\"const\",\"value\":\"0\"}"));
            case "negative_ratio" -> parameter("magic_damage_bonus_true_ratio").put("fixedValue", -0.1);
            case "zero_duration" -> parameter("curse_duration_ms").put("fixedValue", 0);
            case "fractional_duration" -> parameter("curse_duration_ms").put("fixedValue", 3000.5);
            case "missing_duration" -> parameter("curse_duration_ms").remove("fixedValue");
            case "empty_action" -> ((ArrayNode) rule("mark_on_primary_attack").path("actions")).removeAll();
            case "blocked_one" -> ((ObjectNode) rule("mark_on_unblocked_r").path("conditionGroups").get(0).path("conditions").get(1).path("detail").path("comparisonValue")).put("value", 1);
            case "wrong_w_before" -> stateCheck("refresh_on_marked_w").put("comparator", "GTE");
            case "foreign_state" -> ((ObjectNode) graph.path("processes").get(0).path("stateOperations").get(0)).put("stateSkillKey", BURST);
            case "synthetic_true_damage" -> ((ObjectNode) graph.path("effects").get(0).path("results").get(0).path("detail")).put("damageTypeKey", "true");
            case "delivery" -> ((ObjectNode) graph.path("effects").get(0).path("results").get(0).path("detail")).put("deliveryKind", "BASIC_ATTACK");
            case "missing_target" -> ((ObjectNode) rule("derive_true_on_marked_magic").path("actions").get(0)).remove("targetContext");
            default -> fail(mutation);
        }
        install();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(true, 1)));
    }

    @Test
    void missingLocalEffectAndParameterAreNotHiddenByDormancy() throws Exception {
        ((ObjectNode) rule("derive_true_on_marked_magic").path("actions").get(0).path("detail")).put("effectKey", "missing");
        install(); assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(true, 1)));
        ((ObjectNode) rule("derive_true_on_marked_magic").path("actions").get(0).path("detail")).put("effectKey", "curse_true_damage");
        ((ObjectNode) graph.path("internalStates").get(0).path("detail").path("durationValue")).put("parameterKey", "missing");
        install(); assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(true, 1)));
    }

    @Test
    void missingExternalDefinitionIsNeverLoadedByDefinitionOnlyProof() {
        fixture.attach("hero_b", ATTACK, PASSIVE, AREA);
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, targetSettings(List.of(new SkillSetting(Origin.character("hero_b"), PASSIVE, true, 1)))));
        verify(fixture.configurations, never()).get(GAME, BURST);
    }

    @Test
    void knownForeignSideDefinitionCannotStandInForOwnersMissingRelationship() {
        fixture.attach("hero_a", ATTACK, BURST);
        fixture.attach("hero_b", ATTACK, PASSIVE, AREA);
        var error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, targetSettings(List.of(new SkillSetting(Origin.character("hero_b"), PASSIVE, true, 1)))));
        assertTrue(error.getDetails().toString().contains("REFERENCE_OUT_OF_SCOPE"));
    }

    @Test
    void globallyDisabledExternalDefinitionIsRejectedEvenWhenItsSceneToggleIsClosed() throws Exception {
        fixture.configuration(BURST, 1, SkillStatus.DISABLED, "{}");
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, targetSettings(List.of(
            new SkillSetting(Origin.character("hero_b"), PASSIVE, true, 1), new SkillSetting(Origin.character("hero_b"), BURST, false, 1)))));
    }

    @Test
    void closedUnplannedSiblingNeedsOnlyItsExistingDefinitionNotRunnableInternals() throws Exception {
        fixture.configuration(AREA, 1, "{\"parameters\":[{\"parameterKey\":\"unused\",\"valueType\":\"DECIMAL\",\"valueMode\":\"FIXED\",\"fixedValue\":null}]}");
        var result = fixture.service.get(GAME, targetSettings(List.of(new SkillSetting(Origin.character("hero_b"), PASSIVE, true, 1),
            new SkillSetting(Origin.character("hero_b"), BURST, false, 1), new SkillSetting(Origin.character("hero_b"), AREA, false, 0))));
        assertEquals(InactiveReason.NO_REACHABLE_EVENT, source(result.target(), PASSIVE).inactiveReason());
        assertEquals(InactiveReason.SCENE_DISABLED, source(result.target(), AREA).inactiveReason());
        assertTrue(result.references().stream().noneMatch(row -> row.sourceSkillKey().equals(PASSIVE) || row.sourceSkillKey().equals(AREA)));
    }

    @Test
    void switchedOffUnlearnedAndUnspecifiedLevelKeepTheirOriginalGates() {
        assertEquals(InactiveReason.SCENE_DISABLED, source(fixture.service.get(GAME, selection(false, 1)).target(), PASSIVE).inactiveReason());
        assertEquals(InactiveReason.UNLEARNED, source(fixture.service.get(GAME, selection(true, 0)).target(), PASSIVE).inactiveReason());
        assertNotEquals(InactiveReason.NO_REACHABLE_EVENT, source(fixture.service.get(GAME,
            targetSettings(List.of(new SkillSetting(Origin.character("hero_b"), PASSIVE, true, null)))).target(), PASSIVE).inactiveReason());
        verifyNoInteractions(fixture.damageTypes);
    }

    @Test
    void realReceivedAttackRootIsNeverHiddenByTheDormantClassification() throws Exception {
        ObjectNode received = rule("mark_on_primary_attack").deepCopy(); received.put("ruleKey", "actual_received");
        received.set("eventSource", fixture.json.readTree("{\"eventType\":\"BASIC_ATTACK_RECEIVED\",\"detail\":{}}"));
        received.putArray("conditionGroups"); ((ArrayNode) graph.path("triggerRules")).add(received);
        install();
        var result = fixture.service.get(GAME, selection(true, 1));
        assertNull(source(result.target(), PASSIVE).inactiveReason());
        assertEquals(List.of("actual_received"), source(result.target(), PASSIVE).enabledRuleKeys());
    }

    @Test
    void realPrimaryDamageSourceKeepsOnlyItsReachableMarkRule() throws Exception {
        sourceGraph(); damageCatalogs();
        fixture.configuration(ATTACK, 2, "{\"effects\":[" + damage("primary", "physics", "BASIC_ATTACK") + "],\"triggerRules\":["
            + effectRule("on_hit", "BASIC_ATTACK_HIT", "{}", "primary") + "]}");
        var result = fixture.service.get(GAME, sourceSelection(List.of()));
        assertNull(source(result.source(), PASSIVE).inactiveReason());
        assertEquals(List.of("mark_on_primary_attack"), source(result.source(), PASSIVE).enabledRuleKeys());
        assertCompleteDamageCatalogs(result);
        assertFalse(result.references().stream().anyMatch(row -> row.sourceSkillKey().equals(PASSIVE)
            && row.targetType().equals("DAMAGE_TYPE") && !row.targetKey().equals("physics")));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void realPlannedMagicSiblingSelectsOnlyActualDamageAndHitRulesNotBareArea(boolean selectedBasicAttack) throws Exception {
        sourceGraph(); damageCatalogs();
        fixture.configuration(BURST, 1, """
            {"effects":[%s],"processes":[{"processKey":"cast","activationType":"ACTIVE","cooldown":null,
             "steps":[{"stepKey":"release","sortOrder":10,"stepType":"DELAY","occupiesAction":true,"detail":{"delayValue":{"kind":"FIXED","value":250}}}],
             "effectBindings":[],"stateOperations":[]}],"triggerRules":[
             {"ruleKey":"on_used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"%s","useKind":"ACTIVE","castPhase":"INITIAL"}},
              "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"cast"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}]},%s]}
            """.formatted(damage("burst", "magic", "SKILL"), BURST, effectRule("on_hit", "SKILL_HIT",
                "{\"sourceSkillKey\":\"" + BURST + "\",\"processMoment\":{\"processKey\":\"cast\",\"moment\":{\"momentType\":\"STEP_EXECUTION\",\"stepKey\":\"release\"},\"requiresPriorStepKey\":null}}", "burst")));
        var result = fixture.service.get(GAME, sourceSelection(List.of(new PlannedSkill(Origin.character("hero_a"), BURST, 1, List.of("INITIAL"))), selectedBasicAttack));
        assertNull(source(result.source(), PASSIVE).inactiveReason());
        assertEquals(List.of("derive_true_on_marked_magic", "mark_on_unblocked_r"), source(result.source(), PASSIVE).enabledRuleKeys());
        assertFalse(result.references().stream().anyMatch(row -> row.sourceSkillKey().equals(PASSIVE) && row.sourceKey().equals("refresh_on_marked_w")));
        assertCompleteDamageCatalogs(result);
        assertFalse(result.references().stream().anyMatch(row -> row.sourceSkillKey().equals(PASSIVE)
            && row.targetType().equals("DAMAGE_TYPE") && row.targetKey().equals("physics")));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void realAreaMagicProducerSelectsItsDamageAndRefreshButNotBurstOrPrimary(boolean selectedBasicAttack) throws Exception {
        sourceGraph(); damageCatalogs();
        fixture.configuration(AREA, 1, "{\"effects\":[" + damage("pulse", "magic", "SKILL") + "],\"triggerRules\":["
            + effectRule("initialize", "SOURCE_INITIALIZED", "{}", "pulse") + "]}");
        var result = fixture.service.get(GAME, sourceSelection(List.of(), selectedBasicAttack));
        assertNull(source(result.source(), PASSIVE).inactiveReason());
        assertEquals(List.of("derive_true_on_marked_magic", "refresh_on_marked_w"), source(result.source(), PASSIVE).enabledRuleKeys());
        assertCompleteDamageCatalogs(result);
    }

    @Test
    void globallyDisabledRawGraphDoesNotRequestDefinitionCatalogsOrExternalSkills() throws Exception {
        fixture.configuration(PASSIVE, 1, SkillStatus.DISABLED, graph.toString());
        when(fixture.relations.listCharacterRelations(GAME, "hero_b", null)).thenReturn(new CharacterSkillRelationListResponse(
            List.of(new CharacterSkillRelationResponse(GAME, "hero_b", "hero_b", PASSIVE, PASSIVE, SkillStatus.DISABLED, 0)), 1));
        var result = fixture.service.get(GAME, targetSettings(List.of()));
        assertEquals(InactiveReason.GLOBAL_DISABLED, source(result.target(), PASSIVE).inactiveReason());
        verifyNoInteractions(fixture.damageTypes);
        verify(fixture.configurations, never()).get(GAME, BURST);
        verify(fixture.configurations, never()).get(GAME, AREA);
    }

    @Test
    void definitionFormulaAttributesDoNotExtendExecutionReferencesOrActorValues() throws Exception {
        sourceGraph();
        fixture.configuration(ATTACK, 2, "{\"effects\":[" + damage("primary", "physics", "BASIC_ATTACK") + "],\"triggerRules\":["
            + effectRule("on_hit", "BASIC_ATTACK_HIT", "{}", "primary") + "]}");
        var original = fixture.service.get(GAME, sourceSelection(List.of()));
        when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse(GAME, "magic",
            DamageTypeFormulaFixtures.definition("1", "bonus_attack_speed_percent"), null));
        var result = fixture.service.get(GAME, sourceSelection(List.of()));
        assertCompleteDamageCatalogs(result);
        assertTrue(result.catalogs().attributes().stream().anyMatch(row -> row.attributeKey().equals("bonus_attack_speed_percent")));
        assertEquals(original.references(), result.references());
        assertEquals(original.source().selectedLevelValues(), result.source().selectedLevelValues());
        assertEquals(original.target().selectedLevelValues(), result.target().selectedLevelValues());
        assertFalse(result.source().selectedLevelValues().has("bonus_attack_speed_percent"));
        assertFalse(result.target().selectedLevelValues().has("bonus_attack_speed_percent"));
        assertEquals(List.of("mark_on_primary_attack"), source(result.source(), PASSIVE).enabledRuleKeys());
    }

    @Test
    void incompleteActiveRawGraphGetsNoExtraCatalogsAndKeepsOriginalClosure() throws Exception {
        sourceGraph();
        fixture.configuration(ATTACK, 2, "{\"effects\":[" + damage("primary", "physics", "BASIC_ATTACK") + "],\"triggerRules\":["
            + effectRule("on_hit", "BASIC_ATTACK_HIT", "{}", "primary") + "]}");
        ((ObjectNode) graph.path("effects").get(0).path("results").get(0).path("detail")).put("damageTypeKey", "true");
        install();
        var result = fixture.service.get(GAME, sourceSelection(List.of()));
        assertEquals(List.of("physics"), result.catalogs().damageTypes().stream().map(row -> row.type().damageTypeKey()).toList());
        assertEquals(List.of("mark_on_primary_attack"), source(result.source(), PASSIVE).enabledRuleKeys());
        verify(fixture.damageTypes, never()).get(GAME, "magic");
        verify(fixture.damageTypes, never()).get(GAME, "real");
        verify(fixture.damageTypes, never()).get(GAME, "true");
    }

    @Test
    void transportsTheCompleteFiveConstantRealFormulaWithoutExecutingIt() throws Exception {
        JsonNode formula = fixture.json.readTree("""
            {"inputs":[],"stages":[
             {"key":"resistanceBeforePenetration","name":"穿透前抗性","expression":{"op":"const","value":"0"}},
             {"key":"penetrationPercent","name":"比例穿透","expression":{"op":"const","value":"0"}},
             {"key":"penetrationFlat","name":"固定穿透","expression":{"op":"const","value":"0"}},
             {"key":"effectiveResistance","name":"有效抗性","expression":{"op":"const","value":"0"}},
             {"key":"resistanceFactor","name":"结算倍率","expression":{"op":"const","value":"1"}}],
             "outputStageKey":"resistanceFactor"}
            """);
        when(fixture.damageTypes.getFormula(GAME, "real")).thenReturn(new DamageTypeFormulaResponse(GAME, "real", formula, null));
        var result = fixture.service.get(GAME, selection(true, 1));
        assertCompleteDamageCatalogs(result);
        assertEquals(formula, result.catalogs().damageTypes().stream().filter(row -> row.type().damageTypeKey().equals("real"))
            .findFirst().orElseThrow().formula().formula());
        assertTrue(result.references().stream().noneMatch(row -> row.sourceSkillKey().equals(PASSIVE)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "disabled", "unconfigured", "wrong_game", "missing_formula", "corrupt_formula"})
    void rejectsInvalidDefinitionOnlyDamageCatalogs(String mutation) throws Exception {
        switch (mutation) {
            case "missing" -> when(fixture.damageTypes.get(GAME, "magic")).thenThrow(new ApiException(HttpStatus.NOT_FOUND,
                "404.DAMAGE_TYPE_NOT_FOUND", "不存在"));
            case "disabled" -> when(fixture.damageTypes.get(GAME, "magic")).thenReturn(new DamageTypeResponse(GAME, "magic", "magic",
                null, DamageTypeStatus.DISABLED, 0, null, null, true));
            case "unconfigured" -> when(fixture.damageTypes.get(GAME, "magic")).thenReturn(new DamageTypeResponse(GAME, "magic", "magic",
                null, DamageTypeStatus.ENABLED, 0, null, null, false));
            case "wrong_game" -> when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse("foreign", "magic",
                DamageTypeFormulaFixtures.definition("1"), null));
            case "missing_formula" -> when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse(GAME, "magic", null, null));
            case "corrupt_formula" -> when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse(GAME, "magic",
                fixture.json.readTree("{\"inputs\":[],\"stages\":[],\"outputStageKey\":\"missing\"}"), null));
            default -> fail(mutation);
        }
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection(true, 1)));
    }

    private void install() throws Exception { fixture.configuration(PASSIVE, 1, graph.toString()); }

    private ObjectNode rule(String key) { return (ObjectNode) graph.path("triggerRules").valueStream().filter(row -> row.path("ruleKey").asText().equals(key)).findFirst().orElseThrow(); }
    private ObjectNode parameter(String key) { return (ObjectNode) graph.path("parameters").valueStream().filter(row -> row.path("parameterKey").asText().equals(key)).findFirst().orElseThrow(); }
    private ObjectNode stateCheck(String key) { return (ObjectNode) rule(key).path("conditionGroups").get(0).path("conditions").get(0).path("detail"); }
    private static SkillSource source(Combatant combatant, String key) { return combatant.skillSources().stream().filter(row -> row.skillKey().equals(key)).findFirst().orElseThrow(); }
    private static void assertCompleteDamageCatalogs(SimulationSnapshotResponse result) {
        assertEquals(List.of("magic", "physics", "real"), result.catalogs().damageTypes().stream().map(row -> row.type().damageTypeKey()).toList());
    }
    private void sourceGraph() { fixture.attach("hero_a", ATTACK, PASSIVE, BURST, AREA); fixture.attach("hero_b", ATTACK); }
    private void damageCatalogs() {
        for (String key : List.of("magic", "physics", "real")) {
            when(fixture.damageTypes.get(GAME, key)).thenReturn(new DamageTypeResponse(GAME, key, key, null, DamageTypeStatus.ENABLED, 0, null, null, true));
            when(fixture.damageTypes.getFormula(GAME, key)).thenReturn(new DamageTypeFormulaResponse(GAME, key, DamageTypeFormulaFixtures.definition("1"), null));
        }
    }
    private static String damage(String effect, String type, String delivery) {
        return """
            {"effectKey":"%s","results":[{"resultKey":"damage","resultType":"DAMAGE","target":"TARGET","valueRule":{"value":{"kind":"FIXED","value":100}},
             "detail":{"damageTypeKey":"%s","deliveryKind":"%s","originKind":"DIRECT"}}]}
            """.formatted(effect, type, delivery);
    }
    private static String effectRule(String key, String type, String detail, String effect) {
        return """
            {"ruleKey":"%s","eventSource":{"eventType":"%s","detail":%s},"conditionGroups":[],
             "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"%s"},"targetContext":"CURRENT_TARGET","runtimeInputBindings":[],"resultModifiers":[]}]}
            """.formatted(key, type, detail, effect);
    }
    private Selection sourceSelection(List<PlannedSkill> plans) {
        return sourceSelection(plans, true);
    }
    private Selection sourceSelection(List<PlannedSkill> plans, boolean selectedBasicAttack) {
        var original = fixture.choice();
        return new Selection(original.sourceCharacterKey(), original.sourceLevel(), original.targetCharacterKey(), original.targetLevel(),
            selectedBasicAttack ? original.basicAttackSkillKey() : null, selectedBasicAttack ? original.basicAttackLevel() : null, List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_a"), PASSIVE, true, 1), new SkillSetting(Origin.character("hero_a"), BURST, true, 1),
                new SkillSetting(Origin.character("hero_a"), AREA, true, 1)), List.of(), plans);
    }
    private Selection targetSettings(List<SkillSetting> settings) {
        var original = fixture.choice();
        return new Selection(original.sourceCharacterKey(), original.sourceLevel(), original.targetCharacterKey(), original.targetLevel(),
            original.basicAttackSkillKey(), original.basicAttackLevel(), List.of(), List.of(), List.of(), List.of(), List.of(), settings, List.of());
    }

    private Selection selection(boolean enabled, int level) {
        var original = fixture.choice();
        return new Selection(original.sourceCharacterKey(), original.sourceLevel(), original.targetCharacterKey(), original.targetLevel(),
            original.basicAttackSkillKey(), original.basicAttackLevel(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_b"), PASSIVE, enabled, level),
                new SkillSetting(Origin.character("hero_b"), BURST, true, 1),
                new SkillSetting(Origin.character("hero_b"), AREA, true, 1)), List.of());
    }

    private static void rebind(JsonNode value) {
        Map<String, String> bindings = Map.of("lol", GAME, "amumu_p", PASSIVE, "amumu_r", BURST,
            "amumu_w", AREA, "shared_basic_attack", ATTACK, "curse", "target_mark", "apply_curse", "write_mark");
        if (value instanceof ObjectNode object) {
            for (var entry : List.copyOf(object.properties())) {
                JsonNode child = entry.getValue();
                if (child.isTextual() && bindings.containsKey(child.asText())) object.put(entry.getKey(), bindings.get(child.asText()));
                else rebind(child);
            }
        } else if (value instanceof ArrayNode array) {
            for (int index = 0; index < array.size(); index++) {
                JsonNode child = array.get(index);
                if (child.isTextual() && bindings.containsKey(child.asText())) array.set(index, array.textNode(bindings.get(child.asText())));
                else rebind(child);
            }
        }
    }
}
