package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillCastingPhaseSemanticsTest {

    @Test
    void unmodifiedMissingPhaseDoesNotLockUnrelatedConfiguration() {
        assertDoesNotThrow(() -> SkillCastingPhaseSemantics.validate(List.of(
            process("ACTIVE", "recast", "RECAST"),
            trigger("legacy", "{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"skill\",\"useKind\":\"ACTIVE\"}}",
                "{\"actionKey\":\"start\",\"actionType\":\"START_PROCESS\",\"detail\":{\"processKey\":\"cast\"}}")
        )));
    }

    @Test
    void advanceNeverSkipsMissingPhaseOrPassiveProcess() {
        ApiException missing = assertThrows(ApiException.class, () -> SkillCastingPhaseSemantics.validate(List.of(
            process("ACTIVE", "recast", "RECAST"),
            trigger("advance", "{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"skill\",\"useKind\":\"ACTIVE\"}}",
                "{\"actionKey\":\"advance\",\"actionType\":\"ADVANCE_PROCESS\",\"detail\":{\"processKey\":\"cast\",\"stepKey\":\"recast\"}}")
        )));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", missing.getCode());
        assertTrue(missing.getDetails().toString().contains("REQUIRED"));

        ApiException passive = assertThrows(ApiException.class, () -> SkillCastingPhaseSemantics.validate(List.of(
            process("PASSIVE", "recast", "RECAST"),
            trigger("advance", "{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"skill\",\"useKind\":\"ACTIVE\",\"castPhase\":\"RECAST\"}}",
                "{\"actionKey\":\"advance\",\"actionType\":\"ADVANCE_PROCESS\",\"detail\":{\"processKey\":\"cast\",\"stepKey\":\"recast\"}}")
        )));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", passive.getCode());
        assertTrue(passive.getDetails().toString().contains("REFERENCE_TYPE_MISMATCH"));
    }

    @Test
    void changingActivationTypeToPassiveInvalidatesExistingAdvance() {
        ApiException error = assertThrows(ApiException.class, () -> SkillCastingPhaseSemantics.validate(List.of(
            process("PASSIVE", "recast", "RECAST"),
            trigger("advance", "{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"skill\",\"useKind\":\"ACTIVE\",\"castPhase\":\"RECAST\"}}",
                "{\"actionKey\":\"advance\",\"actionType\":\"ADVANCE_PROCESS\",\"detail\":{\"processKey\":\"cast\",\"stepKey\":\"recast\"}}")
        )));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("actions[0].detail.processKey"));
    }

    @Test
    void changingStepTypeInvalidatesExistingAdvance() {
        ApiException error = assertThrows(ApiException.class, () -> SkillCastingPhaseSemantics.validate(List.of(
            process("ACTIVE", "recast", "CHARGE"),
            trigger("advance", "{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"skill\",\"useKind\":\"ACTIVE\",\"castPhase\":\"RECAST\"}}",
                "{\"actionKey\":\"advance\",\"actionType\":\"ADVANCE_PROCESS\",\"detail\":{\"processKey\":\"cast\",\"stepKey\":\"recast\"}}")
        )));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("actions[0].detail.stepKey"));
    }

    @Test
    void explicitPhaseStillForbidsStartOnRecast() {
        ApiException error = assertThrows(ApiException.class, () -> SkillCastingPhaseSemantics.validate(List.of(
            process("ACTIVE", "recast", "RECAST"),
            trigger("start", "{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"skill\",\"useKind\":\"ACTIVE\",\"castPhase\":\"RECAST\"}}",
                "{\"actionKey\":\"start\",\"actionType\":\"START_PROCESS\",\"detail\":{\"processKey\":\"cast\"}}")
        )));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
    }

    private static Aggregate process(String activation, String stepKey, String stepType) {
        return new Aggregate(SourceType.PROCESS, "skill", "cast", AggregateJson.tree("""
            {"activationType":"%s","steps":[{"stepKey":"%s","stepType":"%s","detail":{}}],
             "cooldown":null,"effectBindings":[],"stateOperations":[]}
            """.formatted(activation, stepKey, stepType)));
    }

    private static Aggregate trigger(String key, String eventSource, String action) {
        return new Aggregate(SourceType.TRIGGER, "skill", key, AggregateJson.tree("""
            {"eventSource":%s,"conditionGroups":[],"actions":[%s],"limits":{}}
            """.formatted(eventSource, action)));
    }
}
