package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SkillObjectReferencesTest {
    @Test
    void shieldReceptionProtectsItsZoneAndValueParameter() {
        Aggregate effect = aggregate(SourceType.EFFECT, "s1", "shield", """
            {"results":[{"resultKey":"received","resultType":"SHIELD_RECEIVED_MODIFIER",
              "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"p"}},
              "detail":{"modifierZoneKey":"shield_ratio","operation":"INCREASE"}}]}
            """);
        Target zone = new Target(TargetType.MODIFIER_ZONE, "", "shield_ratio", "");
        Target parameter = new Target(TargetType.PARAMETER, "s1", "p", "");
        var refs = SkillObjectReferences.extractAndValidate("lol", List.of(effect), Set.of(zone, parameter));
        assertEquals(2, refs.size());
        assertReference(refs, SourceType.EFFECT, "shield", "results[0].detail.modifierZoneKey",
            TargetType.MODIFIER_ZONE, "", "shield_ratio", "");
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(effect), Set.of(parameter)));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(effect), Set.of(zone)));
    }

    @Test
    void slowStrengthProtectsItsStatusAndEveryNumericDependency() {
        for (String kind : List.of("PARAMETER", "FORMULA")) {
            String field = kind.equals("PARAMETER") ? "parameterKey" : "formulaKey";
            Aggregate slow = aggregate(SourceType.EFFECT, "s1", "slow", """
                {"results":[{"resultKey":"strength","resultType":"STATUS_OPERATION",
                  "valueRule":{"value":{"kind":"%s","%s":"strength"}},
                  "detail":{"statusKey":"movement_slow","operation":"APPLY"}}]}
                """.formatted(kind, field));
            Target status = new Target(TargetType.STATUS, "", "movement_slow", "");
            Target numeric = new Target(TargetType.valueOf(kind), "s1", "strength", "");
            List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(slow), Set.of(status, numeric));
            assertEquals(2, refs.size());
            assertReference(refs, SourceType.EFFECT, "slow", "results[0].detail.statusKey", TargetType.STATUS, "", "movement_slow", "");
            assertReference(refs, SourceType.EFFECT, "slow", "results[0].valueRule.value." + field,
                TargetType.valueOf(kind), "s1", "strength", "");
            assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(slow), Set.of(status)));
            assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(slow), Set.of(numeric)));
        }
    }

    @Test
    void initializationKeepsEffectReferenceAndRejectsMissingEffect() {
        Aggregate trigger = aggregate(SourceType.TRIGGER, "s1", "initialize", """
            {"eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},
             "conditionGroups":[],"actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT",
               "targetContext":"EVENT_SOURCE","detail":{"effectKey":"passive"},
               "runtimeInputBindings":[],"resultModifiers":[]}]}
            """);
        Set<Target> targets = Set.of(new Target(TargetType.EFFECT, "s1", "passive", ""));
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(trigger), targets);
        assertEquals(1, refs.size());
        assertReference(refs, SourceType.TRIGGER, "initialize", "actions[0].detail.effectKey", TargetType.EFFECT, "s1", "passive", "");
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(trigger), Set.of()));
    }

    @Test
    void oncePerUseGroupKeyIsNotASkillOrUserSkillReference() {
        Aggregate trigger = aggregate(SourceType.TRIGGER, "s1", "eclipse_hit", """
            {"eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},
             "conditionGroups":[],"actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT",
               "targetContext":"CURRENT_TARGET","detail":{"effectKey":"passive"},
               "runtimeInputBindings":[],"resultModifiers":[]}],
             "limits":{"perTargetCooldown":null,"maxTriggersPerProcess":null,
               "oncePerUse":{"groupKey":"s2","scope":"TARGET"}}}
            """);
        Set<Target> targets = Set.of(
            new Target(TargetType.EFFECT, "s1", "passive", ""),
            new Target(TargetType.SKILL, "", "s2", "")
        );
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(trigger), targets);
        assertEquals(1, refs.size());
        assertReference(refs, SourceType.TRIGGER, "eclipse_hit", "actions[0].detail.effectKey", TargetType.EFFECT, "s1", "passive", "");
    }

    @Test
    void directParameterCreatesItsOwnEdgeWhileFixedZeroCreatesNone() {
        Aggregate effect = aggregate(SourceType.EFFECT, "s1", "direct_values", """
            {"results":[
                {"resultKey":"fixed","resultType":"DIRECT_HEAL","valueRule":{"value":{"kind":"FIXED","value":0}}},
                {"resultKey":"parameter","resultType":"DIRECT_HEAL","valueRule":{"value":{"kind":"PARAMETER","parameterKey":"p"}}}
            ]}
            """);
        Target parameter = new Target(TargetType.PARAMETER, "s1", "p", "");
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(effect), Set.of(parameter));
        assertEquals(List.of(new Reference("lol", "s1", SourceType.EFFECT, "direct_values",
            "results[1].valueRule.value.parameterKey", parameter)), refs);

        ApiException removed = assertThrows(ApiException.class,
            () -> SkillObjectReferences.extractAndValidate("lol", List.of(effect), Set.of()));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", removed.getCode());
    }

    @Test
    void everyContractReferenceFieldIsIncluded() {
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", fixture(), catalog());
        assertPaths(refs, "effects", """
            lifecycle.durationValue.formulaKey lifecycle.maxStacksValue.formulaKey lifecycle.applicationStacksValue.formulaKey lifecycle.periodicIntervalValue.formulaKey
            results[0].valueRule.value.formulaKey results[0].detail.damageTypeKey results[0].detail.critical.multiplierValue.formulaKey
            results[0].detail.vampOverrides[0].efficiencyValue.formulaKey results[1].valueRule.value.formulaKey results[2].detail.absorbedDamageTypeKey
            results[3].detail.attributeKey results[3].detail.modifierZoneKey results[4].detail.attributeKey results[5].detail.statusKey
            results[6].detail.affectedSkillScope.skillKeys[0] results[6].detail.affectedSkillScope.skillKeys[1]
            results[7].detail.targetEffectKey results[8].detail.modifierZoneKey results[8].detail.damageTypeKey
            results[9].detail.modifierZoneKey results[10].detail.damageTypeKey results[11].detail.attributeKey
            results[13].detail.attributeKey results[16].detail.affectedSkillScope.skillCategoryKeys[0]
            results[17].detail.modifierZoneKey
            """);
        assertPaths(refs, "process", """
            steps[1].detail.delayValue.formulaKey steps[2].detail.repeatCountValue.formulaKey steps[2].detail.intervalValue.formulaKey
            steps[3].detail.repeatCountValue.formulaKey steps[3].detail.intervalValue.formulaKey steps[4].detail.durationValue.formulaKey
            steps[4].detail.executionCountValue.formulaKey steps[5].detail.minimumChargeValue.formulaKey steps[5].detail.maximumChargeValue.formulaKey
            steps[6].detail.windowValue.formulaKey steps[6].detail.maximumRecastCountValue.formulaKey steps[7].detail.windowValue.formulaKey
            cooldown.durationValue.formulaKey cooldown.startMoment.stepKey effectBindings[0].effectKey effectBindings[0].moment.stepKey
            stateOperations[0].stateKey stateOperations[0].value.formulaKey stateOperations[0].optionKey stateOperations[0].moment.stepKey
            """);
        assertPaths(refs, "counter", "detail.initialValue.formulaKey detail.maxValue.formulaKey");
        assertPaths(refs, "ammo", "detail.initialValue.formulaKey detail.maxValue.formulaKey detail.recoveryIntervalValue.formulaKey");
        assertPaths(refs, "internal_cd", "detail.durationValue.formulaKey");
        assertPaths(refs, "complex", """
            eventSource.detail.effectKey eventSource.detail.resultKey
            conditionGroups[0].conditions[0].detail.attributeKey conditionGroups[0].conditions[0].detail.comparisonValue.formulaKey
            conditionGroups[0].conditions[1].detail.statusKey conditionGroups[0].conditions[1].detail.sourceEffectKey
            conditionGroups[0].conditions[1].detail.sourceResultKey conditionGroups[0].conditions[1].detail.comparisonValue.formulaKey
            conditionGroups[0].conditions[2].detail.stateKey conditionGroups[0].conditions[2].detail.optionKey
            conditionGroups[0].conditions[2].detail.comparisonValue.formulaKey conditionGroups[0].conditions[3].detail.comparisonValue.formulaKey
            actions[0].detail.effectKey actions[1].detail.effectKey actions[1].resultModifiers[0].resultKey
            actions[1].runtimeInputBindings[0].parameterKey actions[1].runtimeInputBindings[1].parameterKey
            actions[1].runtimeInputBindings[1].detail.stateKey actions[1].runtimeInputBindings[1].detail.optionKey
            actions[1].runtimeInputBindings[2].parameterKey actions[1].runtimeInputBindings[2].detail.statusKey
            actions[1].runtimeInputBindings[2].detail.sourceEffectKey actions[1].runtimeInputBindings[2].detail.sourceResultKey
            actions[1].runtimeInputBindings[3].parameterKey actions[1].runtimeInputBindings[3].detail.sourceActionKey
            actions[1].runtimeInputBindings[3].detail.sourceResultKey actions[2].detail.processKey actions[3].detail.processKey
            actions[4].detail.processKey actions[4].detail.stepKey
            limits.perTargetCooldown.durationValue.formulaKey limits.maxTriggersPerProcess.processKey limits.maxTriggersPerProcess.limitValue.formulaKey
            """);
        for (SkillTriggerEventType type : SkillTriggerEventType.values()) {
            String fields = switch (type) {
                case SKILL_USED, SKILL_HIT, HIT_LINK_APPLIED, ATTACK_LINK_APPLIED -> "sourceSkillKey";
                case PROCESS_MOMENT -> "processKey moment.stepKey";
                case PROCESS_CANCEL_REQUESTED -> "processKey";
                case RESULT_AVAILABLE -> "effectKey resultKey";
                case LIFECYCLE_MOMENT -> "effectKey";
                case DAMAGE_PENDING, DAMAGE_DEALT, DAMAGE_TAKEN -> "damageTypeKey";
                case STATUS_CHANGED -> "statusKey";
                case HEALTH_THRESHOLD_CROSSED -> "attributeKey thresholdValue.formulaKey";
                case INTERNAL_STATE_CHANGED -> "stateKey";
                case SPELL_SHIELD_BLOCKED -> "shieldEffectKey";
                case SOURCE_INITIALIZED, BASIC_ATTACK_START, BASIC_ATTACK_HIT, CONTROL_RECEIVED, ENTITY_DIED, ENTITY_UNTARGETABLE, KILL, TAKEDOWN -> "";
            };
            Set<String> expected = fields.isBlank() ? Set.of() : Arrays.stream(fields.split(" "))
                .map(field -> "eventSource.detail." + field).collect(Collectors.toSet());
            assertEquals(expected, refs.stream().filter(ref -> ref.sourceKey().equals("event_" + type))
                .map(Reference::fieldPath).collect(Collectors.toSet()), type.name());
        }
    }

    @Test
    void complexConfigurationPreservesAllTargetKindsAndExactFieldPaths() {
        List<Aggregate> aggregates = fixture();
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", aggregates, catalog());
        assertEquals(Set.of(TargetType.values()), refs.stream().map(ref -> ref.target().type()).collect(Collectors.toSet()));
        assertEquals(Set.of(SourceType.values()), refs.stream().map(Reference::sourceType).collect(Collectors.toSet()));
        assertReference(refs, SourceType.FORMULA, "f", "expression.operands[0].parameterKey", TargetType.PARAMETER, "s1", "p", "");
        assertReference(refs, SourceType.EFFECT, "effects", "results[0].detail.critical.multiplierValue.formulaKey", TargetType.FORMULA, "s1", "f", "");
        assertReference(refs, SourceType.EFFECT, "effects", "results[0].detail.vampOverrides[0].efficiencyValue.formulaKey", TargetType.FORMULA, "s1", "f", "");
        assertReference(refs, SourceType.EFFECT, "effects", "results[6].detail.affectedSkillScope.skillKeys[1]", TargetType.SKILL, "", "s2", "");
        assertReference(refs, SourceType.EFFECT, "effects", "results[16].detail.affectedSkillScope.skillCategoryKeys[0]", TargetType.CATEGORY, "", "magic", "");
        assertReference(refs, SourceType.TRIGGER, "complex", "actions[1].runtimeInputBindings[3].detail.sourceActionKey", TargetType.ACTION, "s1", "complex", "first");
        assertReference(refs, SourceType.TRIGGER, "complex", "actions[1].runtimeInputBindings[3].detail.sourceResultKey", TargetType.RESULT, "s1", "effects", "damage");
        assertReference(refs, SourceType.TRIGGER, "complex", "actions[1].runtimeInputBindings[2].detail.sourceResultKey", TargetType.RESULT, "s1", "effects", "status");
        assertReference(refs, SourceType.PROCESS, "process", "stateOperations[0].optionKey", TargetType.OPTION, "s1", "mode", "on");
        assertReference(refs, SourceType.PROCESS, "process", "cooldown.startMoment.stepKey", TargetType.STEP, "s1", "process", "step0");
        assertReference(refs, SourceType.TRIGGER, "event_SKILL_HIT", "eventSource.detail.sourceSkillKey", TargetType.SKILL, "", "s2", "");
        assertReference(refs, SourceType.TRIGGER, "complex", "limits.maxTriggersPerProcess.limitValue.formulaKey", TargetType.FORMULA, "s1", "f", "");
        assertFalse(refs.stream().anyMatch(ref -> ref.fieldPath().contains("description") || ref.fieldPath().contains("unrelatedKey")));

        Aggregate effects = find(aggregates, SourceType.EFFECT, "effects");
        Set<String> resultTypes = new HashSet<>();
        effects.data().path("results").forEach(result -> resultTypes.add(result.path("resultType").asText()));
        assertEquals(names(SkillEffectResultType.values()), resultTypes);
        assertEquals(names(SkillInternalStateType.values()), aggregates.stream().filter(a -> a.type() == SourceType.STATE)
            .map(a -> a.data().path("stateType").asText()).collect(Collectors.toSet()));
        Set<String> stepTypes = new HashSet<>();
        find(aggregates, SourceType.PROCESS, "process").data().path("steps")
            .forEach(step -> stepTypes.add(step.path("stepType").asText()));
        assertEquals(names(SkillProcessStepType.values()), stepTypes);
        assertEquals(names(SkillTriggerEventType.values()), aggregates.stream().filter(a -> a.type() == SourceType.TRIGGER)
            .map(a -> a.data().path("eventSource").path("eventType").asText()).collect(Collectors.toSet()));
    }

    @Test
    void identicalKeysInDifferentSkillsNeverSatisfyEachOthersReferences() {
        Aggregate first = aggregate(SourceType.FORMULA, "s1", "same", "{\"expression\":{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"same\"}}");
        Aggregate second = aggregate(SourceType.FORMULA, "s2", "same", "{\"expression\":{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"same\"}}");
        Set<Target> targets = new HashSet<>(Set.of(new Target(TargetType.PARAMETER, "s1", "same", "")));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(first, second), targets));
        targets.add(new Target(TargetType.PARAMETER, "s2", "same", ""));
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(first, second), targets);
        assertEquals(Set.of("s1", "s2"), refs.stream().map(ref -> ref.target().skillKey()).collect(Collectors.toSet()));
    }

    @Test
    void removingReferencedResultOptionStepActionOrLifecycleFails() {
        for (String removed : List.of("result", "option", "step", "action", "lifecycle")) {
            List<Aggregate> data = fixture();
            switch (removed) {
                case "result" -> ((ArrayNode) find(data, SourceType.EFFECT, "effects").data().path("results")).remove(0);
                case "option" -> ((ArrayNode) find(data, SourceType.STATE, "mode").data().path("detail").path("options")).removeAll();
                case "step" -> ((ArrayNode) find(data, SourceType.PROCESS, "process").data().path("steps")).remove(0);
                case "action" -> ((ArrayNode) find(data, SourceType.TRIGGER, "complex").data().path("actions")).remove(0);
                case "lifecycle" -> ((ObjectNode) find(data, SourceType.EFFECT, "effects").data()).putNull("lifecycle");
                default -> throw new AssertionError();
            }
            ApiException error = assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", data, catalog()), removed);
            assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        }
    }

    @Test
    void everyExtractedTargetRejectsRemovalAndAllEdgePathsRemainDistinct() {
        List<Aggregate> data = fixture();
        Set<Target> fullCatalog = catalog();
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", data, fullCatalog);
        for (Target target : fullCatalog) {
            if (refs.stream().noneMatch(ref -> ref.target().equals(target))) continue;
            Set<Target> without = new HashSet<>(fullCatalog);
            without.remove(target);
            assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", data, without), target.toString());
        }
        assertEquals(refs.size(), new HashSet<>(refs).size());
        assertTrue(refs.stream().filter(ref -> ref.target().equals(new Target(TargetType.FORMULA, "s1", "f", ""))).count() > 25);
    }

    @Test
    void malformedTypeOrDuplicatedChildCannotBypassReferenceValidation() {
        List<Aggregate> data = fixture();
        ArrayNode steps = (ArrayNode) find(data, SourceType.PROCESS, "process").data().path("steps");
        steps.add(steps.get(0).deepCopy());
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", data, catalog()));
        Aggregate unknown = aggregate(SourceType.FORMULA, "s1", "bad", "{\"expression\":{\"nodeType\":\"UNRECOGNIZED\",\"parameterKey\":\"absent\"}}");
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(unknown), catalog()));
    }

    @Test
    void removingReferencedRootIsRejectedEvenWhenItsOutgoingReferencesDisappear() {
        for (Map.Entry<SourceType, String> target : Map.of(SourceType.FORMULA, "f", SourceType.EFFECT, "effects",
                SourceType.STATE, "mode", SourceType.PROCESS, "process").entrySet()) {
            List<Aggregate> data = fixture();
            data.removeIf(a -> a.type() == target.getKey() && a.key().equals(target.getValue()));
            assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", data, catalog()), target.toString());
        }
    }

    @Test
    void lifecycleBehaviorRequiresOwnLifecycleAndAllSkillScopeAddsNoArtificialTarget() {
        Aggregate effect = aggregate(SourceType.EFFECT, "s1", "own", """
            {"results":[{"resultKey":"haste","resultType":"SKILL_HASTE_MODIFIER",
                "detail":{"affectedSkillScope":{"mode":"ALL"}},"lifecycleBehavior":{"moment":"APPLICATION"}}]}
            """);
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(effect), catalog()));
        ((ObjectNode) effect.data()).set("lifecycle", AggregateJson.tree("{}"));
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(effect), catalog());
        assertEquals(List.of(new Reference("lol", "s1", SourceType.EFFECT, "own", "results[0].lifecycleBehavior",
            new Target(TargetType.LIFECYCLE, "s1", "own", ""))), refs);
    }

    @Test
    void damageModifierConditionIndexesAttributeAndThresholdDependencies() {
        Aggregate effect = aggregate(SourceType.EFFECT, "s1", "modifier", """
            {"results":[{"resultKey":"mod","resultType":"DAMAGE_MODIFIER",
              "detail":{"modifierZoneKey":"zone","condition":{"receiver":"ENEMY_CHAMPION",
                "attributeKey":"hp","attributeValueKind":"CURRENT_RATIO","comparator":"LT",
                "comparisonValue":{"kind":"PARAMETER","parameterKey":"threshold"}}}}]}
            """);
        Target zone = new Target(TargetType.MODIFIER_ZONE, "", "zone", "");
        Target hp = new Target(TargetType.ATTRIBUTE, "", "hp", "");
        Target threshold = new Target(TargetType.PARAMETER, "s1", "threshold", "");
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(effect),
            Set.of(zone, hp, threshold));
        assertReference(refs, SourceType.EFFECT, "modifier", "results[0].detail.condition.attributeKey",
            TargetType.ATTRIBUTE, "", "hp", "");
        assertReference(refs, SourceType.EFFECT, "modifier", "results[0].detail.condition.comparisonValue.parameterKey",
            TargetType.PARAMETER, "s1", "threshold", "");
        ApiException removed = assertThrows(ApiException.class,
            () -> SkillObjectReferences.extractAndValidate("lol", List.of(effect), Set.of(zone, hp)));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", removed.getCode());
    }

    private static List<Aggregate> fixture() {
        List<Aggregate> result = new ArrayList<>();
        result.add(aggregate(SourceType.FORMULA, "s1", "f", """
            {"expression":{"nodeType":"OPERATION","operation":"ADD","operands":[
                {"nodeType":"PARAMETER","parameterKey":"p"},
                {"nodeType":"ATTRIBUTE","attributeOwner":"SOURCE","attributeKey":"hp","attributeValueKind":"TOTAL"}]}}
            """));
        result.add(aggregate(SourceType.EFFECT, "s1", "effects", """
            {"lifecycle":{"durationValue":{"kind":"FORMULA","formulaKey":"f"},"maxStacksValue":{"kind":"FORMULA","formulaKey":"f"},"applicationStacksValue":{"kind":"FORMULA","formulaKey":"f"},"periodicIntervalValue":{"kind":"FORMULA","formulaKey":"f"}},
             "results":[
                {"resultKey":"damage","resultType":"DAMAGE","valueRule":{"value":{"kind":"FORMULA","formulaKey":"f"}},"detail":{"damageTypeKey":"magic","critical":{"multiplierValue":{"kind":"FORMULA","formulaKey":"f"}},"vampQualification":"RESOLVED","vampOverrides":[{"mode":"OVERRIDE","efficiencyValue":{"kind":"FORMULA","formulaKey":"f"}}]}},
                {"resultKey":"heal","resultType":"DIRECT_HEAL","valueRule":{"value":{"kind":"FORMULA","formulaKey":"f"}},"detail":{}},
                {"resultKey":"shield","resultType":"NORMAL_SHIELD","detail":{"absorbedDamageTypeKey":"magic"}},
                {"resultKey":"attribute","resultType":"ATTRIBUTE_CHANGE","detail":{"attributeKey":"hp","modifierZoneKey":"zone"}},
                {"resultKey":"resource","resultType":"RESOURCE_CHANGE","detail":{"attributeKey":"hp"}},
                {"resultKey":"status","resultType":"STATUS_OPERATION","detail":{"statusKey":"poison"}},
                {"resultKey":"cooldown","resultType":"COOLDOWN_CHANGE","detail":{"affectedSkillScope":{"mode":"SKILLS","skillKeys":["s1","s2"]}}},
                {"resultKey":"life","resultType":"LIFECYCLE_OPERATION","detail":{"targetEffectKey":"effects"}},
                {"resultKey":"damage_modifier","resultType":"DAMAGE_MODIFIER","detail":{"modifierZoneKey":"zone","damageTypeKey":"magic"}},
                {"resultKey":"healing_modifier","resultType":"HEALING_MODIFIER","detail":{"modifierZoneKey":"zone"}},
                {"resultKey":"immune","resultType":"DAMAGE_IMMUNITY","detail":{"damageTypeKey":"magic"}},
                {"resultKey":"floor","resultType":"HEALTH_FLOOR","detail":{"attributeKey":"hp"}},
                {"resultKey":"spell_shield","resultType":"SPELL_SHIELD","detail":{}},
                {"resultKey":"execute","resultType":"EXECUTE","detail":{"attributeKey":"hp"}},
                {"resultKey":"hit_link","resultType":"HIT_LINK_APPLICATION","detail":{}},
                {"resultKey":"attack_link","resultType":"ATTACK_LINK_APPLICATION","detail":{}},
                {"resultKey":"haste","resultType":"SKILL_HASTE_MODIFIER","detail":{"affectedSkillScope":{"mode":"CATEGORIES","skillCategoryKeys":["magic"]}}},
                {"resultKey":"shield_received_modifier","resultType":"SHIELD_RECEIVED_MODIFIER","detail":{"modifierZoneKey":"zone"}},
                {"resultKey":"attack_timer_reset","resultType":"ATTACK_TIMER_RESET","valueRule":null,"detail":{}}
             ],"description":"example parameterKey missing is plain text","unrelatedKey":"missing"}
            """));
        result.add(aggregate(SourceType.STATE, "s1", "counter", "{\"stateType\":\"COUNTER\",\"detail\":{\"initialValue\":{\"kind\":\"FORMULA\",\"formulaKey\":\"f\"},\"maxValue\":{\"kind\":\"FORMULA\",\"formulaKey\":\"f\"}}}"));
        result.add(aggregate(SourceType.STATE, "s1", "ammo", "{\"stateType\":\"AMMO\",\"detail\":{\"initialValue\":{\"kind\":\"FORMULA\",\"formulaKey\":\"f\"},\"maxValue\":{\"kind\":\"FORMULA\",\"formulaKey\":\"f\"},\"recoveryIntervalValue\":{\"kind\":\"FORMULA\",\"formulaKey\":\"f\"}}}"));
        result.add(aggregate(SourceType.STATE, "s1", "internal_cd", "{\"stateType\":\"INTERNAL_COOLDOWN\",\"detail\":{\"durationValue\":{\"kind\":\"FORMULA\",\"formulaKey\":\"f\"}}}"));
        result.add(aggregate(SourceType.STATE, "s1", "mode", "{\"stateType\":\"MODE\",\"detail\":{\"options\":[{\"optionKey\":\"on\",\"initial\":true}]}}"));
        result.add(aggregate(SourceType.STATE, "s1", "flag", "{\"stateType\":\"FLAG\",\"detail\":{\"initialEnabled\":false}}"));
        result.add(aggregate(SourceType.PROCESS, "s1", "process", """
            {"steps":[
                {"stepKey":"step0","stepType":"IMMEDIATE","detail":{}},
                {"stepKey":"delay","stepType":"DELAY","detail":{"delayValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"stepKey":"multi","stepType":"MULTI_HIT","detail":{"repeatCountValue":{"kind":"FORMULA","formulaKey":"f"},"intervalValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"stepKey":"periodic","stepType":"PERIODIC","detail":{"repeatCountValue":{"kind":"FORMULA","formulaKey":"f"},"intervalValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"stepKey":"channel","stepType":"CHANNEL","detail":{"durationValue":{"kind":"FORMULA","formulaKey":"f"},"executionCountValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"stepKey":"charge","stepType":"CHARGE","detail":{"minimumChargeValue":{"kind":"FORMULA","formulaKey":"f"},"maximumChargeValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"stepKey":"recast","stepType":"RECAST","detail":{"windowValue":{"kind":"FORMULA","formulaKey":"f"},"maximumRecastCountValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"stepKey":"empowered","stepType":"EMPOWERED_BASIC_ATTACK","detail":{"windowValue":{"kind":"FORMULA","formulaKey":"f"}}}],
             "cooldown":{"durationValue":{"kind":"FORMULA","formulaKey":"f"},"startMoment":{"momentType":"STEP_START","stepKey":"step0"}},
             "effectBindings":[{"effectKey":"effects","moment":{"stepKey":"step0"}}],
             "stateOperations":[{"stateKey":"mode","optionKey":"on","value":{"kind":"FORMULA","formulaKey":"f"},"moment":{"stepKey":"step0"}}]}
            """));
        result.add(aggregate(SourceType.TRIGGER, "s1", "complex", """
            {"eventSource":{"eventType":"RESULT_AVAILABLE","detail":{"effectKey":"effects","resultKey":"damage"}},
             "conditionGroups":[{"conditions":[
                {"conditionType":"ATTRIBUTE_COMPARE","detail":{"attributeKey":"hp","comparisonValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"conditionType":"STATUS_CHECK","detail":{"statusKey":"poison","sourceEffectKey":"effects","sourceResultKey":"status","comparisonValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"conditionType":"INTERNAL_STATE_CHECK","detail":{"stateKey":"mode","optionKey":"on","comparisonValue":{"kind":"FORMULA","formulaKey":"f"}}},
                {"conditionType":"EVENT_VALUE_COMPARE","detail":{"comparisonValue":{"kind":"FORMULA","formulaKey":"f"}}}]}],
             "actions":[
                {"actionKey":"first","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"effects"}},
                {"actionKey":"second","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"effects"},
                 "resultModifiers":[{"resultKey":"damage","fixedMultiplier":1.125}],
                 "runtimeInputBindings":[
                    {"parameterKey":"p","sourceType":"EVENT_VALUE","detail":{}},
                    {"parameterKey":"p","sourceType":"INTERNAL_STATE","detail":{"stateKey":"mode","optionKey":"on"}},
                    {"parameterKey":"p","sourceType":"COMBAT_STATUS","detail":{"statusKey":"poison","sourceEffectKey":"effects","sourceResultKey":"status"}},
                    {"parameterKey":"p","sourceType":"PRIOR_ACTION_RESULT","detail":{"sourceActionKey":"first","sourceResultKey":"damage"}}]},
                {"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"process"}},
                {"actionKey":"fail","actionType":"FAIL_PROCESS","detail":{"processKey":"process"}},
                {"actionKey":"advance","actionType":"ADVANCE_PROCESS","detail":{"processKey":"process","stepKey":"recast"}}],
             "limits":{"perTargetCooldown":{"durationValue":{"kind":"FORMULA","formulaKey":"f"}},"maxTriggersPerProcess":{"processKey":"process","limitValue":{"kind":"FORMULA","formulaKey":"f"}}}}
            """));
        Map<String, String> details = Map.ofEntries(
            Map.entry("SKILL_USED", "{\"sourceSkillKey\":\"s2\"}"), Map.entry("SKILL_HIT", "{\"sourceSkillKey\":\"s2\"}"),
            Map.entry("HIT_LINK_APPLIED", "{\"sourceSkillKey\":\"s2\"}"), Map.entry("ATTACK_LINK_APPLIED", "{\"sourceSkillKey\":\"s2\"}"),
            Map.entry("PROCESS_MOMENT", "{\"processKey\":\"process\",\"moment\":{\"stepKey\":\"step0\"}}"),
            Map.entry("PROCESS_CANCEL_REQUESTED", "{\"processKey\":\"process\"}"),
            Map.entry("RESULT_AVAILABLE", "{\"effectKey\":\"effects\",\"resultKey\":\"damage\"}"),
            Map.entry("LIFECYCLE_MOMENT", "{\"effectKey\":\"effects\"}"),
            Map.entry("DAMAGE_PENDING", "{\"damageTypeKey\":\"magic\"}"), Map.entry("DAMAGE_DEALT", "{\"damageTypeKey\":\"magic\"}"), Map.entry("DAMAGE_TAKEN", "{\"damageTypeKey\":\"magic\"}"),
            Map.entry("STATUS_CHANGED", "{\"statusKey\":\"poison\"}"),
            Map.entry("HEALTH_THRESHOLD_CROSSED", "{\"attributeKey\":\"hp\",\"thresholdValue\":{\"kind\":\"FORMULA\",\"formulaKey\":\"f\"}}"),
            Map.entry("INTERNAL_STATE_CHANGED", "{\"stateKey\":\"counter\"}"),
            Map.entry("SPELL_SHIELD_BLOCKED", "{\"shieldEffectKey\":\"effects\"}"));
        for (SkillTriggerEventType type : SkillTriggerEventType.values()) result.add(aggregate(SourceType.TRIGGER, "s1", "event_" + type,
            "{\"eventSource\":{\"eventType\":\"" + type + "\",\"detail\":" + details.getOrDefault(type.name(), "{}") + "},\"actions\":[],\"conditionGroups\":[]}"));
        return result;
    }

    private static Set<Target> catalog() {
        return Set.of(new Target(TargetType.ATTRIBUTE, "", "hp", ""), new Target(TargetType.PARAMETER, "s1", "p", ""),
            new Target(TargetType.SKILL, "", "s1", ""), new Target(TargetType.SKILL, "", "s2", ""),
            new Target(TargetType.CATEGORY, "", "magic", ""), new Target(TargetType.DAMAGE_TYPE, "", "magic", ""),
            new Target(TargetType.MODIFIER_ZONE, "", "zone", ""), new Target(TargetType.STATUS, "", "poison", ""));
    }
    private static Aggregate aggregate(SourceType type, String skill, String key, String json) {
        return new Aggregate(type, skill, key, AggregateJson.tree(json));
    }
    private static Aggregate find(List<Aggregate> data, SourceType type, String key) {
        return data.stream().filter(a -> a.type() == type && a.key().equals(key)).findFirst().orElseThrow();
    }
    private static Set<String> names(Enum<?>[] values) { return Arrays.stream(values).map(Enum::name).collect(Collectors.toSet()); }
    private static void assertPaths(List<Reference> refs, String sourceKey, String paths) {
        assertEquals(Set.of(paths.strip().split("\\s+")), refs.stream().filter(ref -> ref.sourceKey().equals(sourceKey))
            .map(Reference::fieldPath).collect(Collectors.toSet()), sourceKey);
    }
    private static void assertReference(List<Reference> refs, SourceType sourceType, String sourceKey, String path,
                                        TargetType targetType, String skill, String key, String subKey) {
        assertTrue(refs.contains(new Reference("lol", "s1", sourceType, sourceKey, path, new Target(targetType, skill, key, subKey))), path);
    }
}
