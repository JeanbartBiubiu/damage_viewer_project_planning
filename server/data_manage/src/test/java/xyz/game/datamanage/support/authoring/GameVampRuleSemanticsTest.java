package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.gamevamp.GameVampRule;
import xyz.game.datamanage.model.skilleffect.*;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class GameVampRuleSemanticsTest {
    private static final Map<String, String> ATTRIBUTES = Map.of("omnivamp_percent", "DECIMAL");
    private static final Set<String> CATEGORIES = Set.of("common");

    @Test
    void resolvedInheritanceNeedsOnlyConfiguredTypesAndUnresolvedIsAllowedWithNoGameRules() {
        assertDoesNotThrow(() -> validate(List.of(rule()), damage("RESOLVED", "[]")));
        assertDoesNotThrow(() -> GameVampRuleSemantics.validateFinal(List.of(), Map.of(), Set.of(), Map.of(),
            List.of(damage("UNRESOLVED", "[]"))));
        assertIssue("GAME_VAMP_RULE_REQUIRED", () -> validate(List.of(), damage("RESOLVED", "[]")));
    }

    @Test
    void finalStateRejectsAttributeTypeCategoryAndSkillClassificationChanges() {
        assertIssue("INVALID_SOURCE_ATTRIBUTE", () -> GameVampRuleSemantics.validateFinal(List.of(rule()),
            Map.of("omnivamp_percent", "INTEGER"), CATEGORIES, Map.of(), List.of()));
        assertIssue("INVALID_SKILL_CATEGORY", () -> GameVampRuleSemantics.validateFinal(List.of(rule()),
            ATTRIBUTES, Set.of(), Map.of(), List.of()));
        assertIssue("SKILL_CATEGORY_REQUIRED", () -> GameVampRuleSemantics.validateFinal(List.of(rule()),
            ATTRIBUTES, CATEGORIES, Map.of(), List.of(damage("RESOLVED", "[]"))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "-0.01", "1E400"})
    void defaultEfficiencyMustBeFiniteAndNonNegative(String value) {
        GameVampRule base = rule();
        GameVampRule invalid = new GameVampRule(base.vampType(), base.sourceAttributeKey(), base.basisOutputKind(),
            "null".equals(value) ? null : new BigDecimal(value), base.deliveryKinds(), base.originKinds(), base.skillCategoryKeys());
        assertIssue("RANGE_INVALID", () -> validate(List.of(invalid), damage("UNRESOLVED", "[]")));
    }

    @Test
    void rejectsDuplicateTypesEmptyDimensionsRepeatedMembersAndCrossGameCatalogKeys() {
        assertIssue("DUPLICATE_VAMP_TYPE", () -> validate(List.of(rule(), rule()), damage("UNRESOLVED", "[]")));
        GameVampRule bad = new GameVampRule(SkillEffectVampType.OMNIVAMP, "other_game_attribute",
            SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE, BigDecimal.ZERO,
            List.of(), List.of(SkillEffectDamageOriginKind.DIRECT, SkillEffectDamageOriginKind.DIRECT), List.of("other_game_category"));
        List<Map<String, String>> issues = new ArrayList<>();
        GameVampRuleSemantics.validateRules(List.of(bad), ATTRIBUTES, CATEGORIES, issues);
        for (String code : List.of("INVALID_SOURCE_ATTRIBUTE", "REQUIRED", "INVALID_SET", "INVALID_SKILL_CATEGORY")) {
            assertTrue(issues.stream().anyMatch(i -> code.equals(i.get("code"))), code);
        }
    }

    @Test
    void overridesRequireCorrespondingGameRuleButExplicitZeroAndDisabledAreValid() {
        assertDoesNotThrow(() -> validate(List.of(rule()), damage("RESOLVED", """
            [{"vampType":"OMNIVAMP","mode":"OVERRIDE","basisOutputKind":"ACTUAL_HP_LOSS","efficiencyValue":{"kind":"FIXED","value":0}}]
            """)));
        assertDoesNotThrow(() -> validate(List.of(rule()), damage("RESOLVED", """
            [{"vampType":"OMNIVAMP","mode":"DISABLED","basisOutputKind":null,"efficiencyValue":null}]
            """)));
        assertIssue("GAME_VAMP_RULE_REQUIRED", () -> validate(List.of(rule()), damage("RESOLVED", """
            [{"vampType":"PHYSICAL_VAMP","mode":"DISABLED"}]
            """)));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "[{\"vampType\":\"OMNIVAMP\",\"mode\":\"DISABLED\"}]",
        "[{\"vampType\":\"OMNIVAMP\",\"mode\":\"OVERRIDE\",\"basisOutputKind\":\"ACTUAL_HP_LOSS\",\"efficiencyValue\":{\"kind\":\"FIXED\",\"value\":1}}]"
    })
    void unresolvedCannotCarryExceptions(String overrides) {
        assertIssue("UNRESOLVED_REQUIRES_EMPTY", () -> validate(List.of(rule()), damage("UNRESOLVED", overrides)));
    }

    @Test
    void rejectsDisabledValuesMissingOverrideValuesDuplicateTypesAndLegacyFields() {
        assertIssue("FIELD_MUTEX", () -> validate(List.of(rule()), damage("RESOLVED", """
            [{"vampType":"OMNIVAMP","mode":"DISABLED","efficiencyValue":{"kind":"FIXED","value":0}}]
            """)));
        assertIssue("INVALID_VAMP_BASIS", () -> validate(List.of(rule()), damage("RESOLVED", """
            [{"vampType":"OMNIVAMP","mode":"OVERRIDE"}]
            """)));
        assertIssue("DUPLICATE_VAMP_TYPE", () -> validate(List.of(rule()), damage("RESOLVED", """
            [{"vampType":"OMNIVAMP","mode":"DISABLED"},{"vampType":"OMNIVAMP","mode":"DISABLED"}]
            """)));
        Aggregate legacy = damage("UNRESOLVED", "[]");
        ((com.fasterxml.jackson.databind.node.ObjectNode)legacy.data().path("results").get(0).path("detail")).putArray("vampRules");
        assertIssue("UNKNOWN_FIELD", () -> validate(List.of(rule()), legacy));
    }

    @Test
    void efficiencyParameterLevelsStayNonNegativeAndDisabledDoesNotCreateNumericDependencies() {
        Aggregate override = damage("RESOLVED", """
            [{"vampType":"OMNIVAMP","mode":"OVERRIDE","basisOutputKind":"ACTUAL_HP_LOSS","efficiencyValue":{"kind":"PARAMETER","parameterKey":"efficiency"}}]
            """);
        SkillNumericSemantics.Parameter parameter = new SkillNumericSemantics.Parameter("skill", "efficiency", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":1,\"2\":-0.1}"));
        assertIssue("VALUE_RANGE_INVALID", () -> SkillNumericSemantics.validate(List.of(override), List.of(parameter)));
        Aggregate disabled = damage("RESOLVED", "[{\"vampType\":\"OMNIVAMP\",\"mode\":\"DISABLED\"}]");
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(disabled), List.of()));
        assertTrue(SkillObjectReferences.extractAndValidate("lol", List.of(disabled),
            Set.of(new SkillObjectReferences.Target(SkillObjectReferences.TargetType.DAMAGE_TYPE, "", "physical", "")))
            .stream().noneMatch(r -> r.fieldPath().contains("efficiencyValue")));
    }

    @Test
    void priorHealingOutputRequiresResolvedDamageEvenWithNoOverrides() {
        Aggregate trigger = new Aggregate(SourceType.TRIGGER, "skill", "trigger", AggregateJson.tree("""
            {"actions":[{"actionKey":"first","detail":{"effectKey":"effect"}},
             {"actionKey":"next","runtimeInputBindings":[{"sourceType":"PRIOR_ACTION_RESULT","detail":{
               "sourceActionKey":"first","sourceResultKey":"hit","outputKind":"ACTUAL_HEALING"}}]}]}
            """));
        assertIssue("PRIOR_HEALING_NOT_AVAILABLE", () -> GameVampRuleSemantics.validateFinal(List.of(rule()), ATTRIBUTES,
            CATEGORIES, Map.of("skill", CATEGORIES), List.of(damage("UNRESOLVED", "[]"), trigger)));
        assertDoesNotThrow(() -> GameVampRuleSemantics.validateFinal(List.of(rule()), ATTRIBUTES,
            CATEGORIES, Map.of("skill", CATEGORIES), List.of(damage("RESOLVED", "[]"), trigger)));
    }

    private static void validate(List<GameVampRule> rules, Aggregate damage) {
        GameVampRuleSemantics.validateFinal(rules, ATTRIBUTES, CATEGORIES, Map.of("skill", CATEGORIES), List.of(damage));
    }

    private static GameVampRule rule() {
        return new GameVampRule(SkillEffectVampType.OMNIVAMP, "omnivamp_percent",
            SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE, BigDecimal.ONE,
            List.of(SkillEffectDamageDeliveryKind.SKILL), List.of(SkillEffectDamageOriginKind.DIRECT), List.of("common"));
    }

    private static Aggregate damage(String qualification, String overrides) {
        return new Aggregate(SourceType.EFFECT, "skill", "effect", AggregateJson.tree("""
            {"results":[{"resultKey":"hit","resultType":"DAMAGE","detail":{"damageTypeKey":"physical",
             "deliveryKind":"SKILL","originKind":"DIRECT","vampQualification":"%s","vampOverrides":%s}}]}
            """.formatted(qualification, overrides)));
    }

    private static void assertIssue(String code, org.junit.jupiter.api.function.Executable action) {
        ApiException error = assertThrows(ApiException.class, action);
        assertTrue(error.getDetails().get("fieldIssues").toString().contains(code), error.getDetails().toString());
    }
}
