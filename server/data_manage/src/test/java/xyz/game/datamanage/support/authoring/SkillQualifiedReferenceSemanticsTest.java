package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillQualifiedReferenceSemanticsTest {
    @Test
    void stateReferenceUsesOwningSkillEvenWhenLocalKeyIsIdentical() {
        Aggregate foreign = object(SourceType.STATE, "passive", "count", "{\"stateType\":\"COUNTER\",\"detail\":{}}");
        Aggregate local = object(SourceType.STATE, "active", "count", "{\"stateType\":\"FLAG\",\"detail\":{}}");
        Aggregate rule = object(SourceType.TRIGGER, "active", "read", """
            {"eventSource":{"eventType":"INTERNAL_STATE_CHANGED","detail":{
             "stateSkillKey":"passive","stateKey":"count","changeKind":"VALUE_CHANGED"}}}
            """);
        var refs = SkillObjectReferences.extractAndValidate("test", List.of(rule), List.of(rule, foreign, local), Set.of());
        assertEquals("passive", refs.getFirst().target().skillKey());
        assertDoesNotThrow(() -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(rule, foreign, local)));
        Aggregate changed = object(SourceType.STATE, "passive", "count", "{\"stateType\":\"FLAG\",\"detail\":{}}");
        assertThrows(ApiException.class, () -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(rule, changed, local)));
    }

    @Test
    void changedReferenceMustNameItsOwner() {
        Aggregate rule = object(SourceType.TRIGGER, "active", "read", """
            {"eventSource":{"eventType":"INTERNAL_STATE_CHANGED","detail":{"stateKey":"count","changeKind":"VALUE_CHANGED"}}}
            """);
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("test", List.of(rule), Set.of()));
    }

    @Test
    void foreignStatusResultMustStillMatchIdentityAndPersistentApplication() {
        Aggregate rule = object(SourceType.TRIGGER, "active", "read", """
            {"conditionGroups":[{"conditions":[{"conditionType":"STATUS_CHECK","detail":{
             "effectSkillKey":"passive","sourceEffectKey":"mark","sourceResultKey":"apply","statusKey":"slow"}}]}]}
            """);
        for (String status : List.of("slow", "stun")) {
            Aggregate effect = object(SourceType.EFFECT, "passive", "mark", """
                {"lifecycle":{},"results":[{"resultKey":"apply","resultType":"STATUS_OPERATION",
                 "detail":{"operation":"APPLY","statusKey":"%s"},"lifecycleBehavior":{"moment":"PERSISTENT"}}]}
                """.formatted(status));
            if (status.equals("slow")) assertDoesNotThrow(() -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(effect)));
            else assertThrows(ApiException.class, () -> SkillQualifiedReferenceSemantics.validate(List.of(rule), List.of(effect)));
        }
    }

    @Test
    void recentDamageSourceIndexesOnlyWindowAndExplicitFilters() {
        Aggregate rule = object(SourceType.TRIGGER, "active", "read", """
            {"eventSource":{"eventType":"DAMAGE_TAKEN","detail":{"sourceSkillKey":"enemy"}},
             "actions":[{"actionKey":"cast","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"heal"},
              "runtimeInputBindings":[{"parameterKey":"recent","sourceType":"RECENT_DAMAGE_SUM","detail":{
               "subject":"SOURCE","windowValue":{"kind":"PARAMETER","parameterKey":"window"},
               "sourceSkillKey":"enemy","damageTypeKey":"magic","outputKind":"ACTUAL_HP_LOSS"}}]}]}
            """);
        Aggregate effect = object(SourceType.EFFECT, "active", "heal", "{\"results\":[]}");
        var catalog = Set.of(
            new SkillObjectReferences.Target(SkillObjectReferences.TargetType.SKILL,"","enemy",""),
            new SkillObjectReferences.Target(SkillObjectReferences.TargetType.DAMAGE_TYPE,"","magic",""),
            new SkillObjectReferences.Target(SkillObjectReferences.TargetType.PARAMETER,"active","recent",""),
            new SkillObjectReferences.Target(SkillObjectReferences.TargetType.PARAMETER,"active","window",""));
        var refs = SkillObjectReferences.extractAndValidate("test", List.of(rule), List.of(rule, effect), catalog);
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().equals("eventSource.detail.sourceSkillKey")));
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().endsWith("detail.windowValue.parameterKey")));
    }

    private static Aggregate object(SourceType type, String skill, String key, String json) {
        return new Aggregate(type, skill, key, AggregateJson.tree(json));
    }

    @Test
    void aLocalInputWithTheSameKeyCannotSupplyAnotherSkillsStateDefinition() {
        Aggregate state = object(SourceType.STATE, "passive", "counter", """
            {"stateType":"COUNTER","detail":{"initialValue":{"kind":"PARAMETER","parameterKey":"initial"},
             "maxValue":{"kind":"FIXED","value":10}}}
            """);
        Aggregate process = object(SourceType.PROCESS, "active", "cast", """
            {"steps":[],"stateOperations":[{"stateSkillKey":"passive","stateKey":"counter","operation":"RESET"}]}
            """);
        Aggregate rule = object(SourceType.TRIGGER, "active", "use", """
            {"eventSource":{"eventType":"SKILL_USED","detail":{}},"actions":[{
             "actionType":"START_PROCESS","detail":{"processKey":"cast"},"runtimeInputBindings":[{
             "parameterKey":"initial","sourceType":"COMBAT_ELAPSED_TIME","detail":{"subject":"SOURCE"}}]}]}
            """);
        var parameters = List.of(
            new SkillNumericSemantics.Parameter("active", "initial", "INTEGER", "RUNTIME_INPUT", null, null),
            new SkillNumericSemantics.Parameter("passive", "initial", "INTEGER", "RUNTIME_INPUT", null, null));
        ApiException failure = assertThrows(ApiException.class,
            () -> SkillNumericSemantics.validate(List.of(rule), List.of(rule, process, state), parameters,
                java.util.Map.of(), java.util.Map.of(), java.util.Map.of()));
        assertTrue(failure.getDetails().toString().contains("FOREIGN_RUNTIME_INPUT_UNSUPPORTED"));
    }
}
