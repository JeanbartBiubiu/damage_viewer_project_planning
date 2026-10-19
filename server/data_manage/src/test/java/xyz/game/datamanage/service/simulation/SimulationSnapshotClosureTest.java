package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotClosureTest {
    private SimulationSnapshotFixture fixture;

    @BeforeEach
    void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
    }

    @Test
    void cooldownDurationSnapshotPreservesLifecycleScopeAndItsRealSkillDependency() throws Exception {
        fixture.attach("hero_a", ATTACK, "duration_source", "target_skill");
        fixture.configuration("target_skill", 1, "{}");
        var effect = xyz.game.datamanage.support.authoring.CooldownDurationTestData.effect();
        effect.put("effectKey", "buff").put("name", "有期冷却倍率").put("sortOrder", 0);
        fixture.configuration("duration_source", 1, "{\"effects\":[" + effect + "],\"triggerRules\":[" + initialization("apply", "buff") + "]}");
        var snapshot = fixture.service.get(GAME, fixture.choice());
        var stored = snapshot.skillConfigurations().stream().filter(row -> row.skill().skillKey().equals("duration_source"))
            .findFirst().orElseThrow().effects().getFirst();
        assertEquals("COOLDOWN_DURATION_MODIFIER", stored.results().getFirst().resultType().name());
        assertEquals("SOURCE", stored.lifecycle().instanceScope().name());
        assertEquals(List.of("target_skill"), ((xyz.game.datamanage.model.skilleffect.SkillEffectCooldownDurationModifierDetail)
            stored.results().getFirst().detail()).affectedSkillScope().skillKeys());
        assertTrue(snapshot.references().stream().anyMatch(row -> row.sourceSkillKey().equals("duration_source")
            && row.targetType().equals("SKILL") && row.targetKey().equals("target_skill")));
    }

    @Test
    void resolvedSubscriptionsUseTheRealSameSideProcessAndRemainInactiveWhenTheSourceIsClosed() throws Exception {
        fixture.attach("hero_a", ATTACK, "producer", "subscriber");
        fixture.configuration("producer", 1, """
            {"processes":[{"processKey":"terminal","activationType":"PASSIVE",
              "steps":[{"stepKey":"instant","stepType":"IMMEDIATE","detail":{}}],"effectBindings":[],"stateOperations":[]}],
             "triggerRules":[{"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},
              "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"terminal"},
                "runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        fixture.configuration("subscriber", 1, """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("tail", "{\"kind\":\"FIXED\",\"value\":1}"), subscription("after_terminal", "PROCESS_RESOLVED",
                "{\"sourceSkillKey\":\"producer\",\"processKey\":\"terminal\"}", "tail")));
        Selection base = fixture.choice();
        var opened = fixture.service.get(GAME, base);
        assertNull(source(opened.source(), "subscriber").inactiveReason());
        assertEquals(List.of("after_terminal"), source(opened.source(), "subscriber").enabledRuleKeys());
        assertTrue(opened.references().stream().anyMatch(ref -> ref.sourceSkillKey().equals("subscriber")
            && ref.targetType().equals("PROCESS") && ref.targetSkillKey().equals("producer") && ref.targetKey().equals("terminal")));
        var closed = fixture.service.get(GAME, new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_a"), "producer", false, null)), List.of(), List.of()));
        assertTrue(source(closed.source(), "subscriber").enabledRuleKeys().isEmpty());
        assertFalse(closed.references().stream().anyMatch(ref -> ref.sourceSkillKey().equals("subscriber")));
    }

    @Test
    void processResultAndLifecycleSubscriptionsReachAllNecessaryResultsToAFixedPoint() throws Exception {
        fixture.attach("hero_a", ATTACK, "natural");
        String base = heal("base", "{\"kind\":\"FIXED\",\"value\":1}");
        base = base.substring(0, base.lastIndexOf('}')) + ",\"lifecycle\":{\"instanceScope\":\"SKILL\",\"maxStacksValue\":{\"kind\":\"FIXED\",\"value\":1}}}";
        fixture.configuration("natural", 1, """
            {"effects":[%s,%s,%s,%s],"processes":[{"processKey":"first","activationType":"PASSIVE",
              "steps":[{"stepKey":"instant","stepType":"IMMEDIATE","detail":{}}],
              "effectBindings":[{"bindingKey":"apply","effectKey":"base","moment":{"momentType":"PROCESS_COMPLETE"}}],"stateOperations":[]}],
             "triggerRules":[{"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},
                "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"first"},
                  "runtimeInputBindings":[],"resultModifiers":[]}]},
               %s,%s,%s]}
            """.formatted(base, heal("process_tail", "{\"kind\":\"FIXED\",\"value\":2}"),
                heal("result_tail", "{\"kind\":\"FIXED\",\"value\":3}"), heal("life_tail", "{\"kind\":\"FIXED\",\"value\":4}"),
                subscription("process_finished", "PROCESS_MOMENT", "{\"processKey\":\"first\",\"moment\":{\"momentType\":\"PROCESS_COMPLETE\"}}", "process_tail"),
                subscription("result_finished", "RESULT_AVAILABLE", "{\"effectKey\":\"base\",\"resultKey\":\"amount\"}", "result_tail"),
                subscription("life_applied", "LIFECYCLE_MOMENT", "{\"effectKey\":\"base\",\"moment\":\"APPLICATION\"}", "life_tail")));
        var result = fixture.service.get(GAME, fixture.choice());
        for (String key : List.of("process_tail", "result_tail", "life_tail")) {
            assertTrue(result.references().stream().anyMatch(reference -> reference.targetType().equals("EFFECT") && reference.targetKey().equals(key)), key);
        }
        assertEquals(4, result.skillConfigurations().stream().filter(configuration -> configuration.skill().skillKey().equals("natural"))
            .findFirst().orElseThrow().effects().size());
        assertEquals(List.of("initialize"), source(result.source(), "natural").enabledRuleKeys());
    }

    @Test
    void missingParallelResultInAnEventTailRejectsTheWholeOpenedProgram() throws Exception {
        fixture.attach("hero_a", ATTACK, "natural");
        fixture.configuration("natural", 1, """
            {"effects":[%s,{"effectKey":"tail","results":[
              {"resultKey":"first","resultType":"DIRECT_HEAL","target":"SOURCE","detail":{},"valueRule":{"value":{"kind":"FIXED","value":1}}},
              {"resultKey":"second","resultType":"DIRECT_HEAL","target":"SOURCE","detail":{},
                "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"missing"}}}]}],
             "triggerRules":[%s,%s]}
            """.formatted(heal("base", "{\"kind\":\"FIXED\",\"value\":1}"), initialization("initialize", "base"),
                subscription("tail", "RESULT_AVAILABLE", "{\"effectKey\":\"base\",\"resultKey\":\"amount\"}", "tail")));
        ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, fixture.choice()));
        assertTrue(error.getDetails().toString().contains("REFERENCE_MISSING"));
        assertTrue(error.getDetails().toString().contains("effects.tail.results[1].valueRule.value.parameterKey"));
    }

    @Test
    void missingGradeInAnEventTailRemainsReadableWithoutAnEmptySuccessfulProgram() throws Exception {
        fixture.attach("hero_a", ATTACK, "natural");
        fixture.configuration("natural", 3, """
            {"parameters":[{"parameterKey":"amount","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","levelValues":{"1":1,"2":2,"3":3}}],
             "effects":[%s,%s],"triggerRules":[%s,%s]}
            """.formatted(heal("base", "{\"kind\":\"FIXED\",\"value\":1}"), heal("tail", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"amount\"}"),
                initialization("initialize", "base"), subscription("tail", "RESULT_AVAILABLE", "{\"effectKey\":\"base\",\"resultKey\":\"amount\"}", "tail")));
        var result = fixture.service.get(GAME, fixture.choice());
        assertEquals(InactiveReason.LEVEL_REQUIRED, source(result.source(), "natural").inactiveReason());
        assertNull(source(result.source(), "natural").skillLevel());
        assertTrue(source(result.source(), "natural").enabledRuleKeys().isEmpty());
        assertFalse(result.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals("natural")));
    }

    @Test
    void finiteExpiryAndPeriodicSubscriptionsAreNotInventedForAPermanentNonperiodicEffect() throws Exception {
        fixture.attach("hero_a", ATTACK, "natural");
        fixture.configuration("natural", 1, """
            {"effects":[{"effectKey":"base","lifecycle":{"instanceScope":"SKILL"},"results":[]}],"triggerRules":[%s,%s,%s]}
            """.formatted(initialization("initialize", "base"),
                subscription("end", "LIFECYCLE_MOMENT", "{\"effectKey\":\"base\",\"moment\":\"NATURAL_END\"}", "missing_end"),
                subscription("periodic", "LIFECYCLE_MOMENT", "{\"effectKey\":\"base\",\"moment\":\"PERIODIC\"}", "missing_periodic")));
        var result = fixture.service.get(GAME, fixture.choice());
        assertNull(source(result.source(), "natural").inactiveReason());
        assertFalse(result.references().stream().anyMatch(reference -> reference.targetKey().equals("missing_end") || reference.targetKey().equals("missing_periodic")));
        assertEquals(3, result.skillConfigurations().stream().filter(configuration -> configuration.skill().skillKey().equals("natural"))
            .findFirst().orElseThrow().triggerRules().size());
    }

    @Test
    void actualStateMutationFindsSameSideSubscriptionsButClosedSourcesNeverSubscribe() throws Exception {
        fixture.attach("hero_a", ATTACK, "natural", "subscriber");
        fixture.configuration("natural", 1, """
            {"internalStates":[{"stateKey":"count","stateType":"COUNTER","scope":"SKILL",
              "detail":{"initialValue":{"kind":"FIXED","value":0},"maxValue":{"kind":"FIXED","value":3}}}],
             "processes":[{"processKey":"first","activationType":"PASSIVE","steps":[{"stepKey":"instant","stepType":"IMMEDIATE","detail":{}}],
              "effectBindings":[],"stateOperations":[{"operationKey":"gain","stateSkillKey":"natural","stateKey":"count","operation":"INCREASE",
                "value":{"kind":"FIXED","value":1},"moment":{"momentType":"PROCESS_START"}}]}],
             "triggerRules":[{"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],
              "actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"first"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        fixture.configuration("subscriber", 1, """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("tail", "{\"kind\":\"FIXED\",\"value\":1}"), subscription("state_tail", "INTERNAL_STATE_CHANGED",
                "{\"stateSkillKey\":\"natural\",\"stateKey\":\"count\",\"changeKind\":\"VALUE_CHANGED\"}", "tail")));
        var opened = fixture.service.get(GAME, fixture.choice());
        assertTrue(opened.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals("subscriber") && reference.targetKey().equals("tail")));
        assertNull(source(opened.source(), "subscriber").inactiveReason());
        Selection base = fixture.choice();
        var closed = fixture.service.get(GAME, new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_a"), "subscriber", false, null)), List.of(), List.of()));
        assertFalse(closed.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals("subscriber")));
        assertEquals(InactiveReason.SCENE_DISABLED, source(closed.source(), "subscriber").inactiveReason());
        assertEquals(3, closed.skillConfigurations().size());
    }

    private static String subscription(String rule, String event, String detail, String effect) {
        return """
            {"ruleKey":"%s","eventSource":{"eventType":"%s","detail":%s},"conditionGroups":[],
             "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE",
              "detail":{"effectKey":"%s"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """.formatted(rule, event, detail, effect);
    }

    @Test
    void qLikeActiveSiblingStateCooldownAndCostNeverBecomeNaturalRequiredInputs() throws Exception {
        fixture.attach("hero_a", ATTACK, "sample_q");
        var configuration = fixture.configuration("sample_q", 5, """
            {"parameters":[
              {"parameterKey":"passive_amount","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","levelValues":{"3":3}},
              {"parameterKey":"active_cost","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","levelValues":{}},
              {"parameterKey":"active_state","valueType":"DECIMAL","valueMode":"FIXED","fixedValue":null},
              {"parameterKey":"active_cooldown","valueType":"DECIMAL","valueMode":"FIXED","fixedValue":null}],
             "effects":[%s,{"effectKey":"cost","results":[{"resultKey":"consume","resultType":"RESOURCE_CHANGE","target":"SOURCE",
               "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"active_cost"}},
               "detail":{"attributeKey":"active_only_resource","operation":"CONSUME"}}]}],
             "internalStates":[{"stateKey":"active_count","stateType":"COUNTER","scope":"SKILL",
               "detail":{"initialValue":{"kind":"PARAMETER","parameterKey":"active_state"},"maxValue":{"kind":"FIXED","value":5}}}],
             "processes":[{"processKey":"active_process","activationType":"ACTIVE",
               "steps":[{"stepKey":"instant","stepType":"IMMEDIATE","detail":{}}],
               "cooldown":{"durationValue":{"kind":"PARAMETER","parameterKey":"active_cooldown"},"startMoment":{"momentType":"PROCESS_START"}},
               "effectBindings":[{"bindingKey":"cost","effectKey":"cost","moment":{"momentType":"PROCESS_START"}}],
               "stateOperations":[{"operationKey":"increase","stateSkillKey":"sample_q","stateKey":"active_count","operation":"INCREASE",
                 "value":{"kind":"FIXED","value":1},"moment":{"momentType":"PROCESS_START"}}]}],
             "triggerRules":[%s,{"ruleKey":"active","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"sample_q","castPhase":"INITIAL"}},
               "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"active_process"},
                 "runtimeInputBindings":[],"resultModifiers":[]}]},%s]}
            """.formatted(heal("passive", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"passive_amount\"}"),
                initialization("initialize", "passive"),
                subscription("active_tail", "PROCESS_MOMENT", "{\"processKey\":\"active_process\",\"moment\":{\"momentType\":\"PROCESS_COMPLETE\"}}",
                    "missing_active_only")));
        Selection base = fixture.choice();
        var result = fixture.service.get(GAME, new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_a"), "sample_q", true, 3)), List.of(), List.of()));
        assertNull(source(result.source(), "sample_q").inactiveReason());
        assertEquals(List.of("initialize"), source(result.source(), "sample_q").enabledRuleKeys());
        assertEquals(configuration, result.skillConfigurations().stream().filter(skill -> skill.skill().skillKey().equals("sample_q")).findFirst().orElseThrow());
        assertFalse(result.references().stream().anyMatch(reference -> reference.targetKey().startsWith("active_")
            || reference.sourceKey().startsWith("active") || reference.targetKey().equals("cost") || reference.targetKey().equals("missing_active_only")));
        assertFalse(result.catalogs().attributes().stream().anyMatch(attribute -> attribute.attributeKey().equals("active_only_resource")));
    }

    private static SkillSource source(Combatant combatant, String key) {
        return combatant.skillSources().stream().filter(source -> source.skillKey().equals(key)).findFirst().orElseThrow();
    }
}
