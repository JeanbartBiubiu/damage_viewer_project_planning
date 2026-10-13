package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillChargeDurationSemanticsTest {
    private static final String SKILL = "charge_skill";

    @Test
    void hitBindingAndConditionRequireTheSameRealInitialAndChargeReleaseProcess() {
        List<Aggregate> context = context();
        Aggregate hit = hit();
        assertTrue(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL, context));
        assertTrue(SkillChargeDurationSemantics.valueAvailable(hit, context));
        assertDoesNotThrow(() -> SkillChargeDurationSemantics.validate(List.of(hit), context));
        List<Aggregate> missingRelease = context.stream().filter(object -> !object.key().equals("release")).toList();
        ApiException error = assertThrows(ApiException.class, () -> SkillChargeDurationSemantics.validate(List.of(hit), missingRelease));
        assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
        assertTrue(error.getDetails().toString().contains("conditionGroups[0].conditions[0].detail.eventValueKey"));
        assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, "foreign", context));
        assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, null, context));
    }

    @ParameterizedTest
    @ValueSource(strings = {"initial", "release", "cast"})
    void removalOfAnyNecessaryCompositionClosesTheCapability(String key) {
        assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL,
            context().stream().filter(object -> !object.key().equals(key)).toList()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"DELAY", "RECAST", "CHANNEL", "MULTI_HIT"})
    void nonChargeStepsDoNotProvideChargeDuration(String type) {
        List<Aggregate> context = context();
        context.set(0, object(SourceType.PROCESS, "cast", """
            {"activationType":"ACTIVE","steps":[{"stepKey":"charge","stepType":"%s","detail":{}}]}
            """.formatted(type)));
        assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL, context));
    }

    @Test
    void releaseMustAdvanceTheSameChargeStepAndCannotStartOrAdvanceAnotherProcess() {
        for (String action : List.of(
            "{\"actionType\":\"ADVANCE_PROCESS\",\"detail\":{\"processKey\":\"other\",\"stepKey\":\"charge\"}}",
            "{\"actionType\":\"ADVANCE_PROCESS\",\"detail\":{\"processKey\":\"cast\",\"stepKey\":\"missing\"}}",
            "{\"actionType\":\"START_PROCESS\",\"detail\":{\"processKey\":\"cast\"}}")) {
            List<Aggregate> context = context();
            context.set(2, object(SourceType.TRIGGER, "release", """
                {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"charge_skill","castPhase":"CHARGE_RELEASE"}},"actions":[%s]}
                """.formatted(action)));
            assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL, context));
        }
    }

    @Test
    void passiveAndMultipleActiveProcessesAreNotArbitrarilySelected() {
        List<Aggregate> context = context();
        context.add(object(SourceType.PROCESS, "other", """
            {"activationType":"ACTIVE","steps":[{"stepKey":"charge","stepType":"CHARGE"}]}
            """));
        assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL, context));
        context = context();
        context.set(0, object(SourceType.PROCESS, "cast", """
            {"activationType":"PASSIVE","steps":[{"stepKey":"charge","stepType":"CHARGE"}]}
            """));
        assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL, context));
    }

    @ParameterizedTest
    @ValueSource(strings = {"STEP_EXECUTION", "STEP_COMPLETE", "STEP_TIMEOUT"})
    void existingRealChargeProcessMomentsStillProvideTheirOwnDuration(String moment) {
        Aggregate rule = object(SourceType.TRIGGER, "moment", """
            {"eventSource":{"eventType":"PROCESS_MOMENT","detail":{"processKey":"cast","moment":{"momentType":"%s","stepKey":"charge"}}}}
            """.formatted(moment));
        assertTrue(SkillChargeDurationSemantics.valueAvailable(rule, context()));
    }

    @Test
    void numericFinalValidationAlsoRejectsLostReleaseAndWrongProcessMoments() {
        List<Aggregate> context = context();
        Aggregate condition = object(SourceType.TRIGGER, "hit", """
            {"eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"charge_skill"}},
             "conditionGroups":[{"conditions":[{"conditionType":"EVENT_VALUE_COMPARE","detail":{"eventValueKey":"CHARGE_DURATION_MS",
               "comparator":"GTE","comparisonValue":{"kind":"FIXED","value":0}}}]}],"actions":[]}
            """);
        context.add(condition);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(context, List.of()));
        context.removeIf(object -> object.key().equals("release"));
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(context, List.of()));
        assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
        Aggregate start = object(SourceType.TRIGGER, "start", """
            {"eventSource":{"eventType":"PROCESS_MOMENT","detail":{"processKey":"cast","moment":{"momentType":"PROCESS_START"}}}}
            """);
        assertFalse(SkillChargeDurationSemantics.valueAvailable(start, context()));
    }

    @Test
    void declaredAutomaticReleaseProvesTheRealHitWithoutGrantingAManualReleaseRoot() {
        List<Aggregate> context = automaticContext("true");
        assertTrue(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL, context));
        assertDoesNotThrow(() -> SkillChargeDurationSemantics.validate(List.of(hit()), context));
        assertFalse(context.stream().anyMatch(object -> object.key().equals("release")));
        context.removeIf(object -> object.key().equals("initial"));
        assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL, context));
    }

    @ParameterizedTest
    @ValueSource(strings = {"false", "null", "\"true\"", "1", "{}"})
    void missingFalseOrNonBooleanAutomaticReleaseCannotSupplyAChargeHit(String declaration) {
        assertFalse(SkillChargeDurationSemantics.hitAvailable(SKILL, SKILL, automaticContext(declaration)));
    }

    private static List<Aggregate> automaticContext(String declaration) {
        List<Aggregate> context = context();
        context.removeIf(object -> object.key().equals("release"));
        context.set(0, object(SourceType.PROCESS, "cast", """
            {"activationType":"ACTIVE","steps":[{"stepKey":"charge","stepType":"CHARGE",
              "detail":{"minimumChargeValue":{"kind":"FIXED","value":0},"maximumChargeValue":{"kind":"FIXED","value":6000},"releaseAtMaximum":%s}}]}
            """.formatted(declaration)));
        return context;
    }

    private static List<Aggregate> context() {
        return new ArrayList<>(List.of(
            object(SourceType.PROCESS, "cast", """
                {"activationType":"ACTIVE","steps":[{"stepKey":"charge","stepType":"CHARGE",
                  "detail":{"minimumChargeValue":{"kind":"FIXED","value":0},"maximumChargeValue":{"kind":"FIXED","value":6000},"releaseAtMaximum":false}}]}
                """),
            object(SourceType.TRIGGER, "initial", """
                {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"charge_skill","castPhase":"INITIAL"}},
                 "conditionGroups":[],"actions":[{"actionType":"START_PROCESS","detail":{"processKey":"cast"},"runtimeInputBindings":[]}]}
                """),
            object(SourceType.TRIGGER, "release", """
                {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"charge_skill","castPhase":"CHARGE_RELEASE"}},
                 "conditionGroups":[],"actions":[{"actionType":"ADVANCE_PROCESS","detail":{"processKey":"cast","stepKey":"charge"},"runtimeInputBindings":[]}]}
                """)));
    }

    private static Aggregate hit() {
        return object(SourceType.TRIGGER, "hit", """
            {"eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"charge_skill"}},
             "conditionGroups":[{"conditions":[{"conditionType":"EVENT_VALUE_COMPARE","detail":{"eventValueKey":"CHARGE_DURATION_MS"}}]}],
             "actions":[{"runtimeInputBindings":[{"sourceType":"EVENT_VALUE","detail":{"eventValueKey":"CHARGE_DURATION_MS"}}]}]}
            """);
    }

    private static Aggregate object(SourceType type, String key, String json) {
        return new Aggregate(type, SKILL, key, AggregateJson.tree(json));
    }
}
