package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Validation;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

/** Final aggregate validation used by protected configuration writes; no database or runtime. */
class SkillSettledEventHealAuthoringTest {
    private static final String SKILL = "settled_heal";

    @Test
    void existingCompleteAuthorShapeKeepsDecimalEventBindingAndOnePercentParameter() throws Exception {
        var objects = aggregate();
        var rule = new ObjectMapper().findAndRegisterModules().treeToValue(objects.get(2).data(), SkillTriggerRuleCreateRequest.class);
        assertTrue(Validation.buildDefaultValidatorFactory().getValidator().validate(rule).isEmpty());
        var binding = rule.actions().getFirst().runtimeInputBindings().getFirst();
        assertEquals("settled_damage", binding.parameterKey());
        assertEquals(SkillTriggerEventValueKey.POST_DEFENSE_DAMAGE,
            ((SkillTriggerEventValueBindingDetail) binding.detail()).eventValueKey());
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects, parameters("DECIMAL", "RUNTIME_INPUT")));
        var references = SkillObjectReferences.extractAndValidate("lol", objects, catalog());
        assertTrue(references.stream().anyMatch(ref -> ref.fieldPath().equals("actions[0].runtimeInputBindings[0].parameterKey")
            && ref.target().equals(target(TargetType.PARAMETER, "settled_damage"))));
        assertTrue(references.stream().anyMatch(ref -> ref.target().equals(target(TargetType.PARAMETER, "heal_percent_points"))));
        assertTrue(references.stream().anyMatch(ref -> ref.target().equals(target(TargetType.FORMULA, "heal"))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "duplicate", "extra", "fixed_instead", "integer_instead"})
    void aggregateRejectsIncompleteOrUnavailableSupplyWithoutInventingDefaults(String mode) {
        var objects = aggregate();
        ObjectNode rule = (ObjectNode) objects.get(2).data();
        ArrayNode bindings = (ArrayNode) rule.path("actions").get(0).path("runtimeInputBindings");
        var parameters = parameters("DECIMAL", "RUNTIME_INPUT");
        String code;
        switch (mode) {
            case "missing" -> { bindings.removeAll(); code = "BINDING_MISSING"; }
            case "duplicate" -> { bindings.add(bindings.get(0).deepCopy()); code = "BINDING_DUPLICATE"; }
            case "extra" -> {
                ((ObjectNode) bindings.get(0)).put("parameterKey", "unused");
                parameters = new ArrayList<>(parameters);
                parameters.add(new Parameter(SKILL, "unused", "DECIMAL", "RUNTIME_INPUT", null, null));
                code = "BINDING_EXTRA";
            }
            case "fixed_instead" -> { parameters = parameters("DECIMAL", "FIXED"); code = "BINDING_EXTRA"; }
            case "integer_instead" -> { parameters = parameters("INTEGER", "RUNTIME_INPUT"); code = "REFERENCE_TYPE_MISMATCH"; }
            default -> throw new AssertionError(mode);
        }
        var selectedParameters = parameters;
        var error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, selectedParameters));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_USED", "SKILL_HIT", "SOURCE_INITIALIZED"})
    void ruleServiceEventCapabilityRejectsPostDefenseSupplyOutsideRealDamageEvents(String event) {
        // General availability is checked by SkillTriggerRuleService using this
        // capability table; aggregate numeric validation owns binding completeness.
        assertFalse(SkillTriggerEventCapabilities.eventValueAllowed(SkillTriggerEventType.valueOf(event),
            SkillTriggerEventValueKey.POST_DEFENSE_DAMAGE, null, null));
        assertTrue(SkillTriggerEventCapabilities.eventValueAllowed(SkillTriggerEventType.DAMAGE_DEALT,
            SkillTriggerEventValueKey.POST_DEFENSE_DAMAGE, null, null));
    }

    @ParameterizedTest
    @ValueSource(strings = {"settled_damage", "heal_percent_points", "heal", "restore"})
    void finalAggregateCannotDeleteAnyStillReferencedObject(String key) {
        var objects = aggregate();
        Set<Target> catalog = new HashSet<>(catalog());
        TargetType type = switch (key) {
            case "heal" -> TargetType.FORMULA;
            case "restore" -> TargetType.EFFECT;
            default -> TargetType.PARAMETER;
        };
        catalog.remove(target(type, key));
        objects.removeIf(object -> object.key().equals(key));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", objects, catalog));
    }

    private static ArrayList<Aggregate> aggregate() {
        var objects = new ArrayList<Aggregate>();
        objects.add(new Aggregate(SourceType.FORMULA, SKILL, "heal", AggregateJson.tree("""
            {"formulaKey":"heal","expression":{"inputs":[
             {"key":"damage","binding":{"kind":"parameter","skillKey":"settled_heal","parameterKey":"settled_damage"}},
             {"key":"percent","binding":{"kind":"parameter","skillKey":"settled_heal","parameterKey":"heal_percent_points"}}],
             "stages":[{"key":"amount","name":"本笔金额治疗","expression":{"op":"div","args":[
               {"op":"mul","args":[{"op":"read","inputKey":"damage"},{"op":"read","inputKey":"percent"}]},
               {"op":"const","value":"100"}]}}],"outputStageKey":"amount"}}
            """)));
        objects.add(new Aggregate(SourceType.EFFECT, SKILL, "restore", AggregateJson.tree("""
            {"effectKey":"restore","name":"本来源自疗","lifecycle":null,"results":[{"resultKey":"heal","name":"自疗",
             "resultType":"DIRECT_HEAL","target":"SOURCE","sortOrder":0,"description":null,
             "valueRule":{"value":{"kind":"FORMULA","formulaKey":"heal"},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
             "detail":{},"lifecycleBehavior":null,"spellShieldBlockScope":null}]}
            """)));
        objects.add(new Aggregate(SourceType.TRIGGER, SKILL, "on_damage", AggregateJson.tree("""
            {"ruleKey":"on_damage","name":"本笔技能结算自疗","description":null,"sortOrder":0,
             "eventSource":{"eventType":"DAMAGE_DEALT","detail":{"sourceSkillKey":null,"damageTypeKey":null,"deliveryKind":"SKILL","originKind":"ANY"}},
             "conditionGroups":[{"groupKey":"champion","name":"英雄目标","sortOrder":0,"conditions":[
               {"conditionKey":"champion","conditionType":"TARGET_CATEGORY_CHECK","sortOrder":0,"detail":{"categories":["CHAMPION"]}}]}],
             "actions":[{"actionKey":"restore","name":"自疗","sortOrder":0,"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"restore"},
               "targetContext":"CURRENT_TARGET","runtimeInputBindings":[{"bindingKey":"settled","parameterKey":"settled_damage",
                 "sourceType":"EVENT_VALUE","detail":{"eventValueKey":"POST_DEFENSE_DAMAGE"}}],"resultModifiers":[]}],
             "perTargetCooldown":null,"maxTriggersPerProcess":null,"oncePerUse":null}
            """)));
        return objects;
    }

    private static List<Parameter> parameters(String type, String mode) {
        return List.of(new Parameter(SKILL, "settled_damage", type, mode, "FIXED".equals(mode) ? BigDecimal.ZERO : null, null),
            new Parameter(SKILL, "heal_percent_points", "INTEGER", "FIXED", BigDecimal.valueOf(18), null));
    }
    private static Target target(TargetType type, String key) { return new Target(type, SKILL, key, ""); }
    private static Set<Target> catalog() {
        return Set.of(target(TargetType.PARAMETER, "settled_damage"), target(TargetType.PARAMETER, "heal_percent_points"),
            target(TargetType.FORMULA, "heal"), target(TargetType.EFFECT, "restore"));
    }
}
