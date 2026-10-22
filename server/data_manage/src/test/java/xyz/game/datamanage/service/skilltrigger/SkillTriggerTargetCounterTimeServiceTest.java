package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics;
import xyz.game.datamanage.support.authoring.TargetTimingAuthoringFixture;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerTargetCounterTimeServiceTest {
    @Mock GamesMapper games;
    @Mock SkillMapper skills;
    @Mock SkillTriggerRuleMapper mapper;
    SkillTriggerRuleService service;

    @BeforeEach void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.COUNTER, "TARGET", false)));
        service = service(games, skills, mapper);
    }

    @Test void ownNaturalMarkAndSiblingActivationRemainDistinctAndRoundTrip() {
        var request = request();
        SkillTriggerRuleDetailResponse saved;
        try { saved = service.create(GAME_ID, SKILL_KEY, request); }
        catch (ApiException error) { throw new AssertionError(error.getDetails().toString(), error); }
        assertEquals(request.actions(), saved.actions());
        assertEquals(request.conditionGroups(), saved.conditionGroups());
        assertEquals(request.eventSource(), saved.eventSource());
        assertEquals(SKILL_KEY + "_active", ((SkillTriggerSkillEventDetail) saved.eventSource().detail()).sourceSkillKey());
        assertEquals(saved, service.get(GAME_ID, SKILL_KEY, request.ruleKey()));
    }

    @ParameterizedTest @ValueSource(strings = {"NO_SOURCE", "NO_KIND", "NO_PHASE", "RECAST", "EVENT", "TARGET", "FOREIGN",
        "SKILL_SCOPE", "AMMO", "COOLDOWN", "ZERO", "NEGATIVE", "FRACTION", "UNSAFE", "BINDING", "MODIFIER"})
    void rejectsInvalidNewActionBeforePersistence(String change) {
        ObjectNode tree = (ObjectNode) AggregateJson.tree(AggregateJson.write(request()));
        ObjectNode action = (ObjectNode) tree.path("actions").get(0), detail = (ObjectNode) action.path("detail");
        ObjectNode event = (ObjectNode) tree.path("eventSource"), source = (ObjectNode) event.path("detail");
        switch (change) {
            case "NO_SOURCE" -> source.remove("sourceSkillKey");
            case "NO_KIND" -> source.remove("useKind");
            case "NO_PHASE" -> source.remove("castPhase");
            case "RECAST" -> source.put("castPhase", "RECAST");
            case "EVENT" -> event.put("eventType", "SKILL_HIT");
            case "TARGET" -> action.put("targetContext", "EVENT_SOURCE");
            case "FOREIGN" -> detail.put("stateSkillKey", "foreign");
            case "SKILL_SCOPE" -> when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
                .thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.COUNTER, "SKILL", false)));
            case "AMMO" -> when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
                .thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.AMMO, "TARGET", false)));
            case "COOLDOWN" -> when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
                .thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.INTERNAL_COOLDOWN, "TARGET", false)));
            case "ZERO" -> ((ObjectNode) detail.path("value")).put("value", 0);
            case "NEGATIVE" -> ((ObjectNode) detail.path("value")).put("value", -1);
            case "FRACTION" -> ((ObjectNode) detail.path("value")).put("value", new BigDecimal("0.5"));
            case "UNSAFE" -> ((ObjectNode) detail.path("value")).put("value", new BigDecimal("9007199254740992"));
            case "BINDING" -> action.withArray("runtimeInputBindings").addObject().put("bindingKey", "extra").put("parameterKey", "extra")
                .put("sourceType", "SCENE_INITIAL_PARAMETER").set("detail", AggregateJson.tree("{\"minValue\":0,\"maxValue\":1}"));
            case "MODIFIER" -> action.withArray("resultModifiers").addObject().put("resultKey", "extra").put("fixedMultiplier", 1);
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class)));
        verify(mapper, never()).insertRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    private static SkillTriggerRuleCreateRequest request() {
        var action = new SkillTriggerAction("protect", "保护标记余时", SkillTriggerActionType.MODIFY_INTERNAL_STATE, 0,
            SkillTriggerTargetContext.CURRENT_TARGET, new SkillTriggerModifyInternalStateActionDetail(SKILL_KEY, "mark",
                SkillTriggerInternalStateOperation.ENSURE_REMAINING, SkillNumericValue.fixed(new BigDecimal("1250"))), List.of(), List.of());
        var request = rule("target_time", new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED,
            new SkillTriggerSkillEventDetail(SKILL_KEY + "_active", SkillTriggerEventUseKind.ACTIVE, SkillTriggerCastPhase.INITIAL)), List.of(action));
        ObjectNode tree = (ObjectNode) AggregateJson.tree(AggregateJson.write(request));
        tree.set("conditionGroups", AggregateJson.tree("""
            [{"groupKey":"short_mark","name":"短余时","sortOrder":0,"conditions":[{"conditionKey":"remaining","conditionType":"INTERNAL_STATE_CHECK","sortOrder":0,
              "detail":{"stateSkillKey":"%s","stateKey":"mark","valueKind":"REMAINING_MS","optionKey":null,"expectedBoolean":null,"comparator":"LT","comparisonValue":{"kind":"FIXED","value":1000}}}]}]
            """.formatted(SKILL_KEY)));
        return AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class);
    }

    @Test void phaseExtensionUsesItsOwnHitEventGateAndRoundTripsTheNewOperation() {
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.COUNTER, "TARGET", true)));
        ObjectNode tree = phaseRequest();
        var request = AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class);
        var saved = service.create(GAME_ID, SKILL_KEY, request);
        assertEquals(request.actions(), saved.actions());
        assertEquals(SkillTriggerInternalStateOperation.ENSURE_REMAINING_PRESERVE_PHASE,
            ((SkillTriggerModifyInternalStateActionDetail) saved.actions().getFirst().detail()).operation());
    }

    @ParameterizedTest @ValueSource(strings = {"EVENT", "SOURCE", "TARGET", "ZERO", "AMMO"})
    void phaseExtensionShapeRejectsInvalidInputsBeforeInsert(String change) {
        ObjectNode tree = phaseRequest(), action = (ObjectNode) tree.path("actions").get(0);
        switch (change) {
            case "EVENT" -> ((ObjectNode) tree.path("eventSource")).put("eventType", "BASIC_ATTACK_HIT");
            case "SOURCE" -> ((ObjectNode) tree.path("eventSource").path("detail")).putNull("sourceSkillKey");
            case "TARGET" -> action.put("targetContext", "EVENT_SOURCE");
            case "ZERO" -> ((ObjectNode) action.path("detail")).set("value", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0}"));
            case "AMMO" -> when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.AMMO, "SKILL", false)));
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class)));
        verify(mapper, never()).insertRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test void damageBeforeValueIsAConditionOnlyAndRoundTripsOnDamageDealt() {
        ObjectNode tree = damageBeforeRequest();
        var request = AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class);
        var saved = service.create(GAME_ID, SKILL_KEY, request);
        assertEquals(request.conditionGroups(), saved.conditionGroups());
        assertEquals(SkillTriggerInternalStateValueKind.DAMAGE_BEFORE_VALUE,
            ((SkillTriggerInternalStateConditionDetail) saved.conditionGroups().getFirst().conditions().getFirst().detail()).valueKind());
    }

    @ParameterizedTest @ValueSource(strings = {"CURRENT_TARGET", "EVENT_SOURCE"})
    void timingKillRefundUsesTheExistingDamageDealtContextWithoutGrantingAnEventSource(String context) {
        ObjectNode request = damageBeforeRequest();
        ((ObjectNode) request.path("actions").get(0)).put("targetContext", context);
        var typed = AggregateJson.read(request.toString(), SkillTriggerRuleCreateRequest.class);
        assertFalse(SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.DAMAGE_DEALT));
        if (context.equals("CURRENT_TARGET")) assertDoesNotThrow(() -> service.create(GAME_ID, SKILL_KEY, typed));
        else {
            var error = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, typed));
            assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
            assertTrue(error.getDetails().toString().contains("EVENT_SOURCE_NOT_AVAILABLE"));
        }
        ObjectNode config = TargetTimingAuthoringFixture.configuration();
        ((ObjectNode) TargetTimingAuthoringFixture.find(config, "triggerRules", "ruleKey", "refund").path("actions").get(0))
            .put("targetContext", context);
        assertEquals(context.equals("CURRENT_TARGET"), SkillNumericSemantics.targetTimingNaturalRootsOnly(
            TargetTimingAuthoringFixture.OWNER, config, TargetTimingAuthoringFixture.aggregates(config), List.of()));
        assertEquals("SOURCE", TargetTimingAuthoringFixture.find(config, "effects", "effectKey", "mana").path("results").get(0).path("target").asText());
    }

    @ParameterizedTest @ValueSource(strings = {"ENSURE", "BEFORE"})
    void timingDeclarationMetadataRejectsLegacyEnsureAndPreDamageReadsBeforeInsert(String entry) {
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.COUNTER, "TARGET", true)));
        ObjectNode tree = entry.equals("BEFORE") ? damageBeforeRequest() : (ObjectNode) AggregateJson.tree(AggregateJson.write(request()));
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class)));
        verify(mapper, never()).insertRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @ParameterizedTest @ValueSource(strings = {"ENSURE", "BEFORE"})
    void aLaterTimingDeclarationInvalidatesAnExistingRuleDuringFinalDatabaseRecheck(String entry) {
        ObjectNode tree = entry.equals("BEFORE") ? damageBeforeRequest() : (ObjectNode) AggregateJson.tree(AggregateJson.write(request()));
        var request = AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class);
        service.create(GAME_ID, SKILL_KEY, request);
        when(mapper.listRulesForGame(GAME_ID)).thenAnswer(ignored -> mapper.listRulesForUpdate(GAME_ID, SKILL_KEY));
        assertDoesNotThrow(() -> service.validateAffectedConfigurationFinal(GAME_ID, SKILL_KEY, List.of(), List.of(), List.of("mark")));
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.COUNTER, "TARGET", true)));
        var error = assertThrows(ApiException.class, () -> service.validateAffectedConfigurationFinal(GAME_ID, SKILL_KEY, List.of(), List.of(), List.of("mark")));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
    }

    @ParameterizedTest @ValueSource(strings = {"RECEIVED_EVENT", "FOREIGN", "SKILL_SCOPE", "AMMO"})
    void damageBeforeValueDoesNotBroadenOtherEventsOrStateKinds(String change) {
        ObjectNode tree = damageBeforeRequest();
        switch (change) {
            case "RECEIVED_EVENT" -> ((ObjectNode) tree.path("eventSource")).put("eventType", "DAMAGE_TAKEN");
            case "FOREIGN" -> ((ObjectNode) tree.path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("stateSkillKey", "foreign");
            case "SKILL_SCOPE" -> when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.COUNTER, "SKILL", false)));
            case "AMMO" -> when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of(new SkillTriggerInternalStateLockRow("mark", SkillInternalStateType.AMMO, "TARGET", false)));
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class)));
        verify(mapper, never()).insertRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    private static ObjectNode phaseRequest() {
        ObjectNode tree = (ObjectNode) AggregateJson.tree(AggregateJson.write(request()));
        tree.set("eventSource", AggregateJson.tree("{\"eventType\":\"SKILL_HIT\",\"detail\":{\"sourceSkillKey\":\"" + SKILL_KEY + "_active\"}}"));
        ((ObjectNode) tree.path("actions").get(0).path("detail")).put("operation", "ENSURE_REMAINING_PRESERVE_PHASE");
        ((ObjectNode) tree.path("conditionGroups").get(0)).withArray("conditions").add(AggregateJson.tree("{\"conditionKey\":\"unblocked\",\"conditionType\":\"EVENT_VALUE_COMPARE\",\"sortOrder\":1,\"detail\":{\"eventValueKey\":\"SKILL_HIT_SPELL_SHIELD_BLOCKED\",\"comparator\":\"EQ\",\"comparisonValue\":{\"kind\":\"FIXED\",\"value\":0}}}"));
        return tree;
    }
    private static ObjectNode damageBeforeRequest() {
        ObjectNode tree = (ObjectNode) AggregateJson.tree(AggregateJson.write(request()));
        tree.set("eventSource", AggregateJson.tree("{\"eventType\":\"DAMAGE_DEALT\",\"detail\":{\"sourceSkillKey\":null,\"damageTypeKey\":null,\"deliveryKind\":\"ANY\",\"originKind\":\"ANY\"}}"));
        ((ObjectNode) tree.path("conditionGroups").get(0).path("conditions").get(0).path("detail")).put("valueKind", "DAMAGE_BEFORE_VALUE");
        tree.set("actions", AggregateJson.tree(AggregateJson.write(List.of(executeAction("read", EFFECT_KEY)))));
        return tree;
    }
}
