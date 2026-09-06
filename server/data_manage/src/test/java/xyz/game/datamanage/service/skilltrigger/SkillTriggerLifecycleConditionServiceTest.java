package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerLifecycleConditionServiceTest {
    private static final String PATH = "conditionGroups[0].conditions[0].detail";
    @Mock private GamesMapper games;
    @Mock private SkillMapper skills;
    @Mock private SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.findLifecycleScope(GAME_ID, SKILL_KEY, "mark")).thenReturn(SkillEffectLifecycleInstanceScope.SOURCE_TARGET);
        service = service(games, skills, mapper);
    }

    @ParameterizedTest
    @EnumSource(SkillTriggerLifecycleCheckKind.class)
    void allCheckKindsSurviveRootStorageAndReadBack(SkillTriggerLifecycleCheckKind kind) {
        SkillTriggerLifecycleConditionDetail detail = detail(kind, SkillTriggerSubject.CURRENT_TARGET);
        SkillTriggerRuleDetailResponse saved = service.create(GAME_ID, SKILL_KEY, request(detail));
        assertEquals(detail, assertInstanceOf(SkillTriggerLifecycleConditionDetail.class,
            saved.conditionGroups().getFirst().conditions().getFirst().detail()));
        assertEquals(detail, service.get(GAME_ID, SKILL_KEY, "check_mark").conditionGroups().getFirst().conditions().getFirst().detail());
    }

    @ParameterizedTest
    @EnumSource(SkillEffectLifecycleInstanceScope.class)
    void scopeControlsWhetherSubjectIsRequiredOrForbidden(SkillEffectLifecycleInstanceScope scope) {
        when(mapper.findLifecycleScope(GAME_ID, SKILL_KEY, "mark")).thenReturn(scope);
        boolean needsSubject = scope == SkillEffectLifecycleInstanceScope.TARGET || scope == SkillEffectLifecycleInstanceScope.SOURCE_TARGET;
        service.create(GAME_ID, SKILL_KEY, request(detail(SkillTriggerLifecycleCheckKind.PRESENT,
            needsSubject ? SkillTriggerSubject.CURRENT_TARGET : null)));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY,
            request(detail(SkillTriggerLifecycleCheckKind.PRESENT, needsSubject ? null : SkillTriggerSubject.SOURCE)))),
            PATH + ".subject", needsSubject ? "REQUIRED" : "FORBIDDEN");
    }

    @Test
    void eventSourceSubjectRequiresAnEventThatProvidesOne() {
        SkillTriggerLifecycleConditionDetail detail = detail(SkillTriggerLifecycleCheckKind.PRESENT, SkillTriggerSubject.EVENT_SOURCE);
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail))), PATH + ".subject", "EVENT_SOURCE_NOT_AVAILABLE");
        service.create(GAME_ID, SKILL_KEY, request(detail, SkillTriggerEventType.CONTROL_RECEIVED));
    }

    @Test
    void missingLifecycleAndOtherSkillsEffectAreRejected() {
        when(mapper.findLifecycleScope(GAME_ID, SKILL_KEY, "mark")).thenReturn(null);
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY,
            request(detail(SkillTriggerLifecycleCheckKind.PRESENT, SkillTriggerSubject.CURRENT_TARGET)))),
            PATH + ".effectKey", "UNKNOWN_LIFECYCLE");
        when(mapper.lockEffects(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(EFFECT_KEY));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY,
            request(detail(SkillTriggerLifecycleCheckKind.PRESENT, SkillTriggerSubject.CURRENT_TARGET)))),
            PATH + ".effectKey", "UNKNOWN_EFFECT");
    }

    @ParameterizedTest
    @ValueSource(strings = {"PRESENT", "ABSENT"})
    void presenceKindsRejectComparisonFields(String kind) {
        SkillTriggerLifecycleConditionDetail detail = new SkillTriggerLifecycleConditionDetail("mark", SkillTriggerSubject.CURRENT_TARGET,
            SkillTriggerLifecycleCheckKind.valueOf(kind), SkillTriggerComparator.GTE, SkillNumericValue.fixed(BigDecimal.ZERO));
        ApiException error = thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail)));
        assertField(error, PATH + ".comparator", "FORBIDDEN");
        assertField(error, PATH + ".comparisonValue", "FORBIDDEN");
    }

    @Test
    void stacksRequiresBothComparisonFieldsAndUnknownDetailFieldsAreNotDropped() {
        ApiException missing = thrown(() -> service.create(GAME_ID, SKILL_KEY, request(new SkillTriggerLifecycleConditionDetail(
            "mark", SkillTriggerSubject.CURRENT_TARGET, SkillTriggerLifecycleCheckKind.STACKS_COMPARE, null, null))));
        assertField(missing, PATH + ".comparator", "REQUIRED");
        assertField(missing, PATH + ".comparisonValue", "REQUIRED");
        SkillTriggerLifecycleConditionDetail unknown = AggregateJson.read("""
            {"effectKey":"mark","subject":"CURRENT_TARGET","checkKind":"PRESENT","scope":"SOURCE_TARGET"}
            """, SkillTriggerLifecycleConditionDetail.class);
        assertEquals("400.INVALID_BODY", thrown(() -> service.create(GAME_ID, SKILL_KEY, request(unknown))).getCode());
        assertThrows(IllegalStateException.class, () -> AggregateJson.read("""
            {"effectKey":"mark","subject":"CURRENT_TARGET","checkKind":"REMAINING_MS_COMPARE"}
            """, SkillTriggerLifecycleConditionDetail.class));
    }

    @Test
    void formulaUsedOnlyForConditionStillRejectsRuntimeInput() {
        when(mapper.countRuntimeInputNodes(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(1L);
        SkillTriggerLifecycleConditionDetail detail = new SkillTriggerLifecycleConditionDetail("mark", SkillTriggerSubject.CURRENT_TARGET,
            SkillTriggerLifecycleCheckKind.STACKS_COMPARE, SkillTriggerComparator.GTE, SkillNumericValue.formula(FORMULA_KEY));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail))), PATH + ".comparisonValue", "REFERENCE_TYPE_MISMATCH");
    }

    @Test
    void referencedLifecycleRemovalAndEffectDeletionKeepExistingConflictCodes() {
        when(mapper.countLifecycleReferences(GAME_ID, SKILL_KEY, "mark")).thenReturn(1L);
        xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow existing = org.mockito.Mockito.mock(
            xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow.class);
        ApiException removed = thrown(() -> service.assertEffectUpdate(GAME_ID, SKILL_KEY, "mark", existing, null, List.of(), List.of()));
        assertEquals("409.SKILL_EFFECT_IN_USE", removed.getCode());
        assertField(removed, "lifecycle", "TRIGGER_RULE_LIFECYCLE_IN_USE");
        when(mapper.countEffectReferences(GAME_ID, SKILL_KEY, "mark")).thenReturn(1L);
        assertTrue(service.effectDeleteIssues(GAME_ID, SKILL_KEY, "mark").stream()
            .anyMatch(issue -> "TRIGGER_RULE_EFFECT_IN_USE".equals(issue.get("code"))));
    }

    private static SkillTriggerLifecycleConditionDetail detail(SkillTriggerLifecycleCheckKind kind, SkillTriggerSubject subject) {
        boolean compare = kind == SkillTriggerLifecycleCheckKind.STACKS_COMPARE;
        return new SkillTriggerLifecycleConditionDetail("mark", subject, kind, compare ? SkillTriggerComparator.GTE : null,
            compare ? SkillNumericValue.fixed(BigDecimal.ZERO) : null);
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerLifecycleConditionDetail detail) {
        return request(detail, SkillTriggerEventType.BASIC_ATTACK_HIT);
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerLifecycleConditionDetail detail, SkillTriggerEventType event) {
        return new SkillTriggerRuleCreateRequest("check_mark", "印记检查", null, 0,
            new SkillTriggerEventSource(event, new SkillTriggerEmptyEventDetail()),
            List.of(new SkillTriggerConditionGroup("conditions", "条件", 0,
                List.of(new SkillTriggerCondition("mark_present", SkillTriggerConditionType.LIFECYCLE_CHECK, 0, detail)))),
            List.of(executeAction("deal", EFFECT_KEY)), null, null);
    }
}
