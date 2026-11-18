package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotHitCounterDefinitionTest {
    private static final String HIT = "synthetic_hit", MARK = "synthetic_mark";
    private SimulationSnapshotFixture fixture;
    private ObjectNode hit, mark;

    @BeforeEach void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, HIT, MARK); fixture.attach("hero_b", ATTACK, HIT, MARK);
        hit = node("""
            {"parameters":[],"processes":[{"processKey":"cast","activationType":"ACTIVE","cooldown":null,
              "steps":[{"stepKey":"now","stepType":"IMMEDIATE","occupiesAction":false,"detail":{}}],"effectBindings":[],"stateOperations":[]}],
             "effects":[{"effectKey":"damage","lifecycle":null,"results":[{"resultKey":"hit","resultType":"DAMAGE","target":"TARGET",
              "sortOrder":0,"valueRule":{"value":{"kind":"FIXED","value":10},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
              "detail":{"damageTypeKey":"magic","deliveryKind":"SKILL","originKind":"DIRECT","critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"UNRESOLVED","vampOverrides":[]}}]}],
             "triggerRules":[{"ruleKey":"used","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"synthetic_hit","useKind":"ACTIVE","castPhase":"INITIAL"}},
              "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","targetContext":"CURRENT_TARGET","detail":{"processKey":"cast"},"runtimeInputBindings":[],"resultModifiers":[]}]},
              {"ruleKey":"actual_hit","eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"synthetic_hit"}},
               "conditionGroups":[{"groupKey":"marked","conditions":[{"conditionKey":"count","conditionType":"INTERNAL_STATE_CHECK","detail":{
                "stateSkillKey":"synthetic_mark","stateKey":"count","valueKind":"VALUE","comparator":"GT","comparisonValue":{"kind":"FIXED","value":0},"optionKey":null,"expectedBoolean":null}}]}],
               "actions":[{"actionKey":"damage","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"damage"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        mark = node("""
            {"parameters":[{"parameterKey":"capacity","name":"容量","valueType":"INTEGER","valueMode":"FIXED","fixedValue":3,"levelValues":null}],
             "internalStates":[{"stateKey":"count","stateType":"COUNTER","scope":"TARGET","detail":{
              "initialValue":{"kind":"FIXED","value":0},"maxValue":{"kind":"PARAMETER","parameterKey":"capacity"},"durationValue":{"kind":"FIXED","value":4000}}}],
             "processes":[{"processKey":"producer","activationType":"PASSIVE","cooldown":null,"steps":[{"stepKey":"now","stepType":"IMMEDIATE","occupiesAction":false,"detail":{}}],"effectBindings":[],
               "stateOperations":[{"operationKey":"set","stateSkillKey":"synthetic_mark","stateKey":"count","moment":{"momentType":"PROCESS_START","stepKey":null,"failureReason":null},"sortOrder":0,"operation":"SET","value":{"kind":"FIXED","value":1},"optionKey":null}]}],
             "triggerRules":[{"ruleKey":"producer_root","eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"synthetic_hit"}},"conditionGroups":[],
              "actions":[{"actionKey":"produce","actionType":"START_PROCESS","targetContext":"CURRENT_TARGET","detail":{"processKey":"producer"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        save();
        when(fixture.damageTypes.get(GAME, "magic")).thenReturn(new DamageTypeResponse(GAME, "magic", "魔法", null, DamageTypeStatus.ENABLED, 0, null, null, true));
        when(fixture.damageTypes.getFormula(GAME, "magic")).thenReturn(new DamageTypeFormulaResponse(GAME, "magic", xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition("1"), null));
    }

    private void save() throws Exception { fixture.configuration(HIT, 5, hit.toString()); fixture.configuration(MARK, 5, mark.toString()); }
    private static ObjectNode node(String value) { return (ObjectNode) AggregateJson.tree(value); }
    private ObjectNode check() { return (ObjectNode) hit.path("triggerRules").get(1).path("conditionGroups").get(0).path("conditions").get(0).path("detail"); }
    private ObjectNode state() { return (ObjectNode) mark.path("internalStates").get(0); }
    private Selection choice(boolean enabled, int level, boolean planned) {
        return new Selection("hero_a", 1, "hero_b", 2, ATTACK, 1, List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(Origin.character("hero_a"), HIT, true, 1), new SkillSetting(Origin.character("hero_a"), MARK, enabled, level)),
            List.of(new SkillSetting(Origin.character("hero_b"), HIT, false, 0), new SkillSetting(Origin.character("hero_b"), MARK, false, 0)),
            planned ? List.of(new PlannedSkill(Origin.character("hero_a"), HIT, 1, List.of("INITIAL"))) : List.of());
    }
    private SkillSource source(SimulationSnapshotResponse response) { return response.source().skillSources().stream().filter(s -> s.skillKey().equals(MARK)).findFirst().orElseThrow(); }

    @ParameterizedTest @ValueSource(strings = {"DISABLED", "ZERO_LEVEL"})
    void disabledOrUnlearnedProviderReturnsOnlyCountAndStaticDefinitions(String mode) {
        var response = fixture.service.get(GAME, choice(mode.equals("ZERO_LEVEL"), mode.equals("ZERO_LEVEL") ? 0 : 1, true));
        assertEquals(mode.equals("DISABLED") ? InactiveReason.SCENE_DISABLED : InactiveReason.UNLEARNED, source(response).inactiveReason());
        assertEquals(List.of(HIT), response.executionSkillKeys());
        assertTrue(source(response).enabledRuleKeys().isEmpty());
        assertTrue(response.references().stream().anyMatch(r -> r.sourceSkillKey().equals(HIT) && r.targetSkillKey().equals(MARK) && r.targetType().equals("STATE")));
        assertTrue(response.references().stream().anyMatch(r -> r.sourceSkillKey().equals(MARK) && r.sourceType().equals("STATE") && r.targetKey().equals("capacity")));
        assertFalse(response.references().stream().anyMatch(r -> r.sourceSkillKey().equals(MARK) && !r.sourceType().equals("STATE")));
        assertTrue(response.source().skillSources().stream().filter(s -> s.skillKey().equals(HIT)).findFirst().orElseThrow().enabledRuleKeys().contains("actual_hit"));
    }

    @Test void validEnabledNaturalProducerRemainsItsOwnRealSource() {
        var response = fixture.service.get(GAME, choice(true, 1, true));
        assertNull(source(response).inactiveReason());
        assertTrue(source(response).enabledRuleKeys().contains("producer_root"));
    }

    @Test void unplannedHitDoesNotGainAnEntryOrLoadTheForeignCount() {
        var response = fixture.service.get(GAME, choice(false, 1, false));
        assertFalse(response.references().stream().anyMatch(r -> r.sourceSkillKey().equals(HIT)));
        assertTrue(source(response).enabledRuleKeys().isEmpty());
    }

    @ParameterizedTest @ValueSource(strings = {"SKILL_SCOPE", "PHASE", "RESERVATION", "INITIAL_ONE", "INITIAL_BINDING", "NEGATIVE_CAP", "FRACTION_CAP", "NO_DURATION", "ZERO_DURATION", "FRACTION_DURATION",
        "REMAINING", "BOOLEAN", "OPTION", "FRACTION_THRESHOLD", "NEGATIVE_THRESHOLD", "MIXED_SELF", "SECOND_PROVIDER", "OTHER_EVENT", "OTHER_HIT", "FOREIGN_OWNER", "MISSING_STATE", "DUPLICATE_STATE", "DISABLED_WRITE", "DISABLED_BINDING"})
    void onlyTheExactSameOwnerSelfHitOrdinaryCounterReadReceivesTheException(String mutation) throws Exception {
        ObjectNode detail = (ObjectNode) state().path("detail");
        switch (mutation) {
            case "SKILL_SCOPE" -> state().put("scope", "SKILL");
            case "PHASE" -> detail.set("targetTiming", node("{\"kind\":\"PHASED_TICK\",\"processKey\":\"producer\",\"intervalValue\":{\"kind\":\"FIXED\",\"value\":250},\"phasePolicy\":\"PRESERVE_ON_EXTEND\"}"));
            case "RESERVATION" -> detail.set("targetTiming", node("{\"kind\":\"EXPIRY_PAYLOAD\",\"processKey\":\"producer\"}"));
            case "INITIAL_ONE" -> detail.set("initialValue", node("{\"kind\":\"FIXED\",\"value\":1}"));
            case "INITIAL_BINDING" -> detail.set("initialValueBinding", node("{\"sourceType\":\"SCENE_INITIAL_PARAMETER\",\"parameterKey\":\"initial\"}"));
            case "NEGATIVE_CAP" -> ((ObjectNode) mark.path("parameters").get(0)).put("fixedValue", -1);
            case "FRACTION_CAP" -> ((ObjectNode) mark.path("parameters").get(0)).put("fixedValue", new BigDecimal("0.5"));
            case "NO_DURATION" -> detail.remove("durationValue");
            case "ZERO_DURATION" -> detail.set("durationValue", node("{\"kind\":\"FIXED\",\"value\":0}"));
            case "FRACTION_DURATION" -> detail.set("durationValue", node("{\"kind\":\"FIXED\",\"value\":0.5}"));
            case "REMAINING" -> check().put("valueKind", "REMAINING_MS");
            case "BOOLEAN" -> check().put("expectedBoolean", true);
            case "OPTION" -> check().put("optionKey", "one");
            case "FRACTION_THRESHOLD" -> check().set("comparisonValue", node("{\"kind\":\"FIXED\",\"value\":0.5}"));
            case "NEGATIVE_THRESHOLD" -> check().set("comparisonValue", node("{\"kind\":\"FIXED\",\"value\":-1}"));
            case "MIXED_SELF", "SECOND_PROVIDER" -> {
                var condition = hit.path("triggerRules").get(1).path("conditionGroups").get(0).path("conditions").get(0).deepCopy();
                ((ObjectNode) condition.path("detail")).put("stateSkillKey", mutation.equals("MIXED_SELF") ? HIT : ATTACK);
                ((ObjectNode) condition).put("conditionKey", "second"); ((ObjectNode) hit.path("triggerRules").get(1).path("conditionGroups").get(0)).withArray("conditions").add(condition);
            }
            case "OTHER_EVENT" -> ((ObjectNode) hit.path("triggerRules").get(1).path("eventSource")).put("eventType", "BASIC_ATTACK_HIT").set("detail", node("{}"));
            case "OTHER_HIT" -> ((ObjectNode) hit.path("triggerRules").get(1).path("eventSource").path("detail")).put("sourceSkillKey", ATTACK);
            case "FOREIGN_OWNER" -> fixture.attach("hero_a", ATTACK, HIT);
            case "MISSING_STATE" -> mark.putArray("internalStates");
            case "DUPLICATE_STATE" -> mark.withArray("internalStates").add(state().deepCopy());
            case "DISABLED_WRITE" -> {
                ObjectNode operation = (ObjectNode) mark.path("processes").get(0).path("stateOperations").get(0).deepCopy();
                ((ObjectNode) hit.path("processes").get(0)).withArray("stateOperations").add(operation);
            }
            case "DISABLED_BINDING" -> {
                hit.withArray("parameters").add(node("{\"parameterKey\":\"extra\",\"valueType\":\"INTEGER\",\"valueMode\":\"RUNTIME_INPUT\",\"fixedValue\":null,\"levelValues\":null}"));
                ((ObjectNode) hit.path("triggerRules").get(1).path("actions").get(0)).withArray("runtimeInputBindings")
                    .add(node("{\"bindingKey\":\"foreign\",\"parameterKey\":\"extra\",\"sourceType\":\"INTERNAL_STATE\",\"detail\":{\"stateSkillKey\":\"synthetic_mark\",\"stateKey\":\"count\",\"valueKind\":\"VALUE\",\"optionKey\":null}}"));
            }
            default -> throw new IllegalArgumentException(mutation);
        }
        save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(false, 1, true)), mutation);
    }

    @Test void enabledButMissingNaturalProducerDoesNotFoldToZero() throws Exception {
        mark.putArray("triggerRules"); save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(true, 1, true)));
    }

    @ParameterizedTest @ValueSource(strings = {"NO_PROCESS_START", "PASSIVE_PROCESS", "NO_ACTIVE_USE", "DUPLICATE_INITIAL"})
    void aPlanAloneDoesNotProveAnActualUniqueFirstActiveProcess(String mutation) throws Exception {
        ObjectNode used = (ObjectNode) hit.path("triggerRules").get(0);
        switch (mutation) {
            case "NO_PROCESS_START" -> used.putArray("actions");
            case "PASSIVE_PROCESS" -> ((ObjectNode) hit.path("processes").get(0)).put("activationType", "PASSIVE");
            case "NO_ACTIVE_USE" -> ((ObjectNode) used.path("eventSource").path("detail")).put("useKind", "ANY");
            case "DUPLICATE_INITIAL" -> hit.withArray("triggerRules").add(used.deepCopy().put("ruleKey", "other_first"));
            default -> throw new IllegalArgumentException(mutation);
        }
        save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(false, 1, true)));
    }

    @Test void missingRealProducerDependencyIsRejectedWhenEnabled() throws Exception {
        ((ObjectNode) mark.path("triggerRules").get(0).path("actions").get(0).path("detail")).put("processKey", "absent"); save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(true, 1, true)));
    }

    @Test void ownerLevelAndSameNamedParametersAreNeverBorrowedFromTheReader() throws Exception {
        ((ObjectNode) mark.path("parameters").get(0)).put("valueMode", "SKILL_LEVEL").putNull("fixedValue")
            .set("levelValues", node("{\"1\":3,\"2\":-1}"));
        hit.withArray("parameters").add(node("{\"parameterKey\":\"capacity\",\"valueType\":\"INTEGER\",\"valueMode\":\"FIXED\",\"fixedValue\":999,\"levelValues\":null}"));
        save();
        assertDoesNotThrow(() -> fixture.service.get(GAME, choice(false, 1, true)));
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(false, 2, true)));
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(true, 0, true)), "0级没有对应静态参数时不能借1级");
    }

    @Test void zeroCapacityAndAStaticFormulaUseTheSameExistingNumericContract() throws Exception {
        ((ObjectNode) mark.path("parameters").get(0)).put("fixedValue", 0);
        mark.withArray("formulas").add(node("""
            {"formulaKey":"static_capacity","expression":{"inputs":[{"key":"cap","binding":{"kind":"parameter","skillKey":"synthetic_mark","parameterKey":"capacity"}}],
             "stages":[{"key":"out","name":"容量","expression":{"op":"read","inputKey":"cap"}}],"outputStageKey":"out"}}
            """));
        ((ObjectNode) state().path("detail")).set("maxValue", node("{\"kind\":\"FORMULA\",\"formulaKey\":\"static_capacity\"}"));
        save();
        assertDoesNotThrow(() -> fixture.service.get(GAME, choice(false, 1, true)));
    }

    @ParameterizedTest @ValueSource(strings = {"RUNTIME_INPUT", "NULL_MODE", "UNSAFE", "MISSING_FORMULA", "NULL_LEVEL"})
    void unresolvedStaticMetadataCannotAcquireADefault(String mutation) throws Exception {
        ObjectNode parameter = (ObjectNode) mark.path("parameters").get(0);
        switch (mutation) {
            case "RUNTIME_INPUT" -> parameter.put("valueMode", "RUNTIME_INPUT").putNull("fixedValue");
            case "NULL_MODE" -> parameter.putNull("valueMode");
            case "UNSAFE" -> parameter.put("fixedValue", new BigDecimal("9007199254740992"));
            case "MISSING_FORMULA" -> ((ObjectNode) state().path("detail")).set("maxValue", node("{\"kind\":\"FORMULA\",\"formulaKey\":\"absent\"}"));
            case "NULL_LEVEL" -> parameter.put("valueMode", "SKILL_LEVEL").putNull("fixedValue").set("levelValues", node("{\"2\":3}"));
            default -> throw new IllegalArgumentException(mutation);
        }
        save();
        assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(false, 1, true)));
    }
}
