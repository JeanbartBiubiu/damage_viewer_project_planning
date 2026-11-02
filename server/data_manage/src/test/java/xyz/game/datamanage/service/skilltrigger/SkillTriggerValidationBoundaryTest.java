package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthDirection;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerCatalogValidator;
import xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerPayloadValidator;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerValidationBoundaryTest {
    @Mock private GamesMapper games;
    @Mock private SkillMapper skills;
    @Mock private SkillTriggerRuleMapper mapper;
    private final SkillTriggerPayloadValidator payloads = new SkillTriggerPayloadValidator();
    private SkillTriggerCatalogValidator catalogs;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        catalogs = new SkillTriggerCatalogValidator(mapper, new SkillTriggerRuntimeInputAnalyzer(mapper));
    }

    @Test
    void unavailableReferenceWaitsForCatalogLocksAndRetainsDuplicateKeyPrecedence() {
        var request = rule("threshold", new SkillTriggerEventSource(SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED,
            new SkillTriggerHealthThresholdEventDetail(SkillTriggerSubject.EVENT_SOURCE, ATTRIBUTE_KEY,
                SkillNumericValue.formula(FORMULA_KEY), SkillTriggerHealthDirection.DOWNWARD)),
            List.of(executeAction("deal", EFFECT_KEY)));
        var values = payloads.validateCreate(request);
        assertEquals("EVENT_SOURCE_NOT_AVAILABLE", values.references().referenceIssues().getFirst().get("code"));
        assertThrows(UnsupportedOperationException.class,
            () -> values.references().referenceIssues().getFirst().put("code", "changed"));
        clearInvocations(mapper);

        ApiException error = assertThrows(ApiException.class,
            () -> catalogs.lockAndValidateCatalogs(GAME_ID, SKILL_KEY, values, null));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
        assertField(error, "eventSource.detail.subject", "EVENT_SOURCE_NOT_AVAILABLE");
        var order = inOrder(mapper);
        order.verify(mapper).lockAttributes(GAME_ID, Set.of(ATTRIBUTE_KEY));
        order.verify(mapper).lockDamageTypes(GAME_ID, Set.of());
        order.verify(mapper).lockStatuses(GAME_ID, Set.of());
        order.verify(mapper).lockFormulas(GAME_ID, SKILL_KEY, Set.of(FORMULA_KEY));
        order.verify(mapper).lockParameters(GAME_ID, SKILL_KEY, Set.of());
        order.verify(mapper).lockEffects(GAME_ID, SKILL_KEY, Set.of(EFFECT_KEY));
        order.verify(mapper).lockProcesses(GAME_ID, SKILL_KEY, Set.of());
        order.verify(mapper).lockSkills(GAME_ID, Set.of());

        when(mapper.countByKey(GAME_ID, SKILL_KEY, "threshold")).thenReturn(1L);
        clearInvocations(mapper);
        assertCode("409.SKILL_TRIGGER_RULE_KEY_EXISTS",
            () -> service(games, skills, mapper).create(GAME_ID, SKILL_KEY, request));
        order = inOrder(mapper);
        order.verify(mapper).listRulesForUpdate(GAME_ID, SKILL_KEY);
        order.verify(mapper).countByKey(GAME_ID, SKILL_KEY, "threshold");
        verifyNoMoreInteractions(mapper);
    }

    @Test
    void retryingTheSamePreparedValuesDoesNotRetainPriorCatalogFailures() {
        var values = payloads.validateCreate(emptyEventExecute("hit", SkillTriggerEventType.BASIC_ATTACK_HIT,
            "deal", EFFECT_KEY));
        when(mapper.lockEffects(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        ApiException failure = assertThrows(ApiException.class,
            () -> catalogs.lockAndValidateCatalogs(GAME_ID, SKILL_KEY, values, null));
        assertField(failure, "actions[0].detail.effectKey", "UNKNOWN_EFFECT");
        when(mapper.lockEffects(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of(EFFECT_KEY));
        assertDoesNotThrow(() -> catalogs.lockAndValidateCatalogs(GAME_ID, SKILL_KEY, values, null));
        assertEquals(List.of(), values.references().referenceIssues());
    }

    @Test
    void oneValidatorKeepsEachRequestsReferenceRequirementsSeparateAndReadOnly() {
        var first = payloads.validateCreate(emptyEventExecute("first", SkillTriggerEventType.BASIC_ATTACK_HIT,
            "deal", EFFECT_KEY));
        var second = payloads.validateCreate(emptyEventExecute("second", SkillTriggerEventType.BASIC_ATTACK_HIT,
            "deal", "other"));
        assertEquals(Set.of(EFFECT_KEY), first.references().effectKeys());
        assertEquals(Set.of("other"), second.references().effectKeys());
        assertThrows(UnsupportedOperationException.class, () -> first.references().effectKeys().add("other"));
        assertThrows(UnsupportedOperationException.class, () -> first.references().effects().clear());
    }
}
