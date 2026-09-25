package xyz.game.datamanage.service.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneApplicationStage;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectAffectedSkillScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttackLinkApplicationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCatalogLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalFilter;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicy;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicyRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDeliveryKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageFilterDeliveryKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageFilterOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageImmunityDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageImmunityDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDirection;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectDirectHealDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectExecuteDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectExecuteDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectHasteModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHasteModifierDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDirection;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealthFloorDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealthFloorDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectHitLinkApplicationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleFirstPeriodicExecution;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecyclePeriodicExecutionMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationDurationMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationStackMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleStackValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleValueReadMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierZoneLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDecayMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldInteractionRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultValueRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSkillCategoryTargetRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSkillScopeMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectSkillScopeRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSkillTargetRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldBlockScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldPolicyRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampBasisOutputKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampOverride;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampType;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillEffectServiceTest {

    private static final String GAME_ID = "lol";
    private static final String SKILL_KEY = "ezreal_q";
    private static final String EFFECT_KEY = "on_hit_results";
    private static final String TARGET_EFFECT_KEY = "mark_effect";
    private static final String CATEGORY_KEY = "displacement";
    private static final String FORMULA_KEY = "base_damage";
    private static final String DAMAGE_ZONE_KEY = "damage_ratio";
    private static final String HEALING_ZONE_KEY = "healing_ratio";
    private static final String DURATION_FORMULA = "duration_f";
    private static final String MAX_STACKS_FORMULA = "max_stacks_f";
    private static final String APP_STACKS_FORMULA = "app_stacks_f";
    private static final String PERIODIC_FORMULA = "periodic_f";
    private static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-27T00:00:00Z");

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillTriggerRuleService triggerRuleService;
    @Mock private ImageRelationMapper imageRelationMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillEffectMapper mapper;

    private SkillEffectService service;
    private final Map<String, Object> fixture = new HashMap<>();
    private SkillEffectRow savedEffect;

    @BeforeEach
    void setUp() {
        service = new SkillEffectService(gamesMapper, skillMapper, mapper, triggerRuleService, imageRelationMapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(this::saveAggregate);
        when(mapper.updateEffect(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(this::saveAggregate);
    }

    @Test
    void shieldReceivedModifierPersistsItsDistinctDetailAndLifecycle() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow("shield_ratio", ModifierZoneDomain.SHIELD, ModifierZoneCalculationMode.RATIO_ADD, ModifierZoneStatus.ENABLED)
        ));
        SkillEffectResultRequest result = shieldReceivedModifierResult();
        SkillEffectDetailResponse saved = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
            EFFECT_KEY, "收到护盾增幅", null, 10, timedLifecycle(), List.of(result)
        ));
        assertEquals(SkillEffectResultType.SHIELD_RECEIVED_MODIFIER, saved.results().getFirst().resultType());
        var detail = assertInstanceOf(
            xyz.game.datamanage.model.skilleffect.SkillEffectShieldReceivedModifierDetail.class,
            saved.results().getFirst().detail()
        );
        assertEquals("shield_ratio", detail.modifierZoneKey());
        assertEquals(SkillEffectModifierOperation.INCREASE, detail.operation());
        assertEquals(AggregateJson.tree(AggregateJson.write(result.valueRule())),
            AggregateJson.tree(AggregateJson.write(saved.results().getFirst().valueRule())));
        assertEquals(AggregateJson.tree(AggregateJson.write(result.lifecycleBehavior())),
            AggregateJson.tree(AggregateJson.write(saved.results().getFirst().lifecycleBehavior())));
    }

    @Test
    void attackTimerResetRoundTripsEmptyDetailAndBothSubjectsWithoutNumericOutput() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        for (SkillEffectTarget target : SkillEffectTarget.values()) {
            SkillEffectResultRequest reset = attackTimerResetResult(target, null);
            var parsed = AggregateJson.read(AggregateJson.write(reset), SkillEffectResultRequest.class);
            assertInstanceOf(xyz.game.datamanage.model.skilleffect.SkillEffectAttackTimerResetDetail.class, parsed.detail());
            assertTrue(parsed.detail().unknownFields().isEmpty());
            SkillEffectDetailResponse saved = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
                EFFECT_KEY, "普攻计时重置", null, 10, null, List.of(parsed)
            ));
            assertEquals(target, saved.results().getFirst().target());
            assertNull(saved.results().getFirst().valueRule());
            assertNull(saved.results().getFirst().lifecycleBehavior());
            assertEquals(AggregateJson.tree("{}"), AggregateJson.tree(AggregateJson.write(saved.results().getFirst().detail())));
            assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputs.available(
                xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputs.Shape.from(parsed, false)).isEmpty());
        }
    }

    @Test
    void attackTimerResetPreservesLegalDiscreteLifecycleMoments() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        for (SkillEffectLifecycleMoment moment : SkillEffectLifecycleMoment.values()) {
            if (moment == SkillEffectLifecycleMoment.PERSISTENT) continue;
            var behavior = new SkillEffectResultLifecycleBehaviorRequest(moment, null, null, null,
                moment == SkillEffectLifecycleMoment.PERIODIC ? SkillEffectLifecyclePeriodicExecutionMode.ONCE_PER_INSTANCE : null);
            var lifecycle = timedLifecycle();
            if (moment == SkillEffectLifecycleMoment.PERIODIC) {
                lifecycle = new SkillEffectLifecycleRequest(lifecycle.durationValue(), lifecycle.maxStacksValue(),
                    lifecycle.applicationStacksValue(), lifecycle.instanceScope(), lifecycle.reapplicationStackMode(),
                    lifecycle.reapplicationDurationMode(), lifecycle.expiryMode(), SkillNumericValue.fixed(new BigDecimal("100")),
                    SkillEffectLifecycleFirstPeriodicExecution.AFTER_INTERVAL);
            }
            SkillEffectDetailResponse saved = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
                EFFECT_KEY, "普攻计时重置", null, 10, lifecycle,
                List.of(attackTimerResetResult(SkillEffectTarget.SOURCE, behavior))
            ));
            assertEquals(moment, saved.results().getFirst().lifecycleBehavior().moment());
            assertNull(saved.results().getFirst().lifecycleBehavior().valueReadMode());
        }
    }

    @Test
    void attackTimerResetRejectsExtraDetailNumericRulesAndInvalidBehaviorBeforeSaving() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        SkillEffectResultRequest reset = attackTimerResetResult(SkillEffectTarget.SOURCE, null);
        for (String field : List.of("operation", "modifierZoneKey", "affectedSkillScope", "ratio")) {
            ObjectNode encoded = (ObjectNode) AggregateJson.tree(AggregateJson.write(reset));
            ((ObjectNode) encoded.path("detail")).putNull(field);
            SkillEffectResultRequest extra = AggregateJson.read(encoded.toString(), SkillEffectResultRequest.class);
            ApiException error = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "重置", null, 10, null, List.of(extra))));
            assertField(error, "results[0].detail." + field, "UNKNOWN_FIELD");
        }
        SkillEffectResultRequest numeric = new SkillEffectResultRequest(reset.resultKey(), reset.name(),
            reset.resultType(), reset.target(), null, 10, valueRule(), reset.detail(), null);
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "重置", null, 10, null, List.of(numeric))));
        SkillEffectResultRequest blocking = new SkillEffectResultRequest(reset.resultKey(), reset.name(),
            reset.resultType(), SkillEffectTarget.TARGET, null, 10, null, reset.detail(), null, SkillEffectSpellShieldBlockScope.RESULT);
        assertField(assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "重置", null, 10, null, List.of(blocking)))),
            "results[0].spellShieldBlockScope", "INVALID_SPELL_SHIELD_SCOPE");
        for (var behavior : List.of(
            new SkillEffectResultLifecycleBehaviorRequest(SkillEffectLifecycleMoment.PERSISTENT, null, null, null, null),
            new SkillEffectResultLifecycleBehaviorRequest(SkillEffectLifecycleMoment.APPLICATION, SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT, null, null, null),
            new SkillEffectResultLifecycleBehaviorRequest(SkillEffectLifecycleMoment.APPLICATION, null, SkillEffectLifecycleStackValueMode.SHARED, null, null),
            new SkillEffectResultLifecycleBehaviorRequest(SkillEffectLifecycleMoment.APPLICATION, null, null, SkillEffectLifecycleReapplicationValueMode.KEEP, null),
            new SkillEffectResultLifecycleBehaviorRequest(SkillEffectLifecycleMoment.APPLICATION, null, null, null, SkillEffectLifecyclePeriodicExecutionMode.ONCE_PER_INSTANCE)
        )) {
            assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "重置", null, 10, timedLifecycle(),
                    List.of(attackTimerResetResult(SkillEffectTarget.SOURCE, behavior)))));
        }
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    private static SkillEffectResultRequest attackTimerResetResult(
        SkillEffectTarget target, SkillEffectResultLifecycleBehaviorRequest behavior
    ) {
        return new SkillEffectResultRequest("attack_reset", "普攻计时重置", SkillEffectResultType.ATTACK_TIMER_RESET,
            target, null, 10, null, new xyz.game.datamanage.model.skilleffect.SkillEffectAttackTimerResetDetail(), behavior);
    }

    @Test
    void shieldReceivedModifierRejectsWrongDomainMissingValueAndDiscretePlacement() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        SkillEffectResultRequest result = shieldReceivedModifierResult();
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow("shield_ratio", ModifierZoneDomain.HEALING, ModifierZoneCalculationMode.RATIO_ADD, ModifierZoneStatus.ENABLED)
        ));
        ApiException wrongDomain = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "护盾修正", null, 10, timedLifecycle(), List.of(result))));
        assertField(wrongDomain, "results[0].detail.modifierZoneKey", "MODIFIER_ZONE_DOMAIN_MISMATCH");
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow("shield_ratio", ModifierZoneDomain.SHIELD, ModifierZoneCalculationMode.RATIO_ADD, ModifierZoneStatus.ENABLED)
        ));
        ApiException noLifecycle = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "护盾修正", null, 10, null, List.of(result))));
        assertField(noLifecycle, "results[0].lifecycleBehavior", "SPECIAL_RESULT_REQUIRES_PERSISTENT");
        SkillEffectResultRequest noValue = new SkillEffectResultRequest(result.resultKey(), result.name(),
            result.resultType(), result.target(), result.description(), result.sortOrder(), null,
            result.detail(), result.lifecycleBehavior());
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "护盾修正", null, 10, timedLifecycle(), List.of(noValue))));
        SkillEffectResultRequest foreign = new SkillEffectResultRequest(result.resultKey(), result.name(),
            result.resultType(), result.target(), result.description(), result.sortOrder(), result.valueRule(),
            new xyz.game.datamanage.model.skilleffect.SkillEffectShieldReceivedModifierDetail(
                "shield_ratio", SkillEffectModifierOperation.INCREASE, Set.of(), Set.of("direction")),
            result.lifecycleBehavior());
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "护盾修正", null, 10, timedLifecycle(), List.of(foreign))));
    }

    private static SkillEffectResultRequest shieldReceivedModifierResult() {
        return new SkillEffectResultRequest("shield_received", "收到护盾提高",
            SkillEffectResultType.SHIELD_RECEIVED_MODIFIER, SkillEffectTarget.SOURCE, null, 1, valueRule(),
            new xyz.game.datamanage.model.skilleffect.SkillEffectShieldReceivedModifierDetail(
                "shield_ratio", SkillEffectModifierOperation.INCREASE), persistentShared());
    }

    @Test
    void ratioMaxHealingModifierAcceptsFortyPercentAndKeepsRatioAddMeanings() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(
                "foo", ModifierZoneDomain.HEALING, ModifierZoneCalculationMode.RATIO_MAX, ModifierZoneStatus.ENABLED)
        ));
        for (SkillEffectHealingKind kind : SkillEffectHealingKind.values()) {
            SkillEffectResultRequest result = healingModifierResult(
                "foo",
                SkillEffectHealingModifierDirection.RECEIVED,
                SkillEffectModifierOperation.DECREASE,
                kind,
                fortyPercentRule()
            );
            SkillEffectDetailResponse saved = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
                EFFECT_KEY, "重伤", null, 10, timedLifecycle(), List.of(result)
            ));
            var detail = assertInstanceOf(SkillEffectHealingModifierDetail.class, saved.results().getFirst().detail());
            assertEquals("foo", detail.modifierZoneKey());
            assertEquals(SkillEffectHealingModifierDirection.RECEIVED, detail.direction());
            assertEquals(SkillEffectModifierOperation.DECREASE, detail.operation());
            assertEquals(kind, detail.healingKind());
            assertEquals(new BigDecimal("0.4"), saved.results().getFirst().valueRule().value().value());
        }

        stubParentAndNewKey();
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(
                "healing_ratio_max",
                ModifierZoneDomain.HEALING,
                ModifierZoneCalculationMode.RATIO_ADD,
                ModifierZoneStatus.ENABLED)
        ));
        SkillEffectResultRequest additive = healingModifierResult(
            "healing_ratio_max",
            SkillEffectHealingModifierDirection.DONE,
            SkillEffectModifierOperation.INCREASE,
            SkillEffectHealingKind.DIRECT,
            fortyPercentRule()
        );
        SkillEffectDetailResponse kept = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
            EFFECT_KEY, "治疗增幅", null, 10, timedLifecycle(), List.of(additive)
        ));
        var additiveDetail = assertInstanceOf(SkillEffectHealingModifierDetail.class, kept.results().getFirst().detail());
        assertEquals(SkillEffectHealingModifierDirection.DONE, additiveDetail.direction());
        assertEquals(SkillEffectModifierOperation.INCREASE, additiveDetail.operation());
    }

    @Test
    void ratioMaxHealingModifierRejectsWrongDomainIncreaseAndDoneDirection() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(
                "foo", ModifierZoneDomain.DAMAGE, ModifierZoneCalculationMode.RATIO_MAX, ModifierZoneStatus.ENABLED)
        ));
        ApiException wrongDomain = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "重伤", null, 10, timedLifecycle(), List.of(
                healingModifierResult(
                    "foo",
                    SkillEffectHealingModifierDirection.RECEIVED,
                    SkillEffectModifierOperation.DECREASE,
                    SkillEffectHealingKind.ANY,
                    fortyPercentRule()
                )
            ))));
        assertField(wrongDomain, "results[0].detail.modifierZoneKey", "MODIFIER_ZONE_DOMAIN_MISMATCH");

        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(
                "foo", ModifierZoneDomain.HEALING, ModifierZoneCalculationMode.RATIO_MAX, ModifierZoneStatus.ENABLED)
        ));
        ApiException increase = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "重伤", null, 10, timedLifecycle(), List.of(
                healingModifierResult(
                    "foo",
                    SkillEffectHealingModifierDirection.RECEIVED,
                    SkillEffectModifierOperation.INCREASE,
                    SkillEffectHealingKind.ANY,
                    fortyPercentRule()
                )
            ))));
        assertField(increase, "results[0].detail.operation", "OPERATION_INVALID");
        ApiException done = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "重伤", null, 10, timedLifecycle(), List.of(
                healingModifierResult(
                    "foo",
                    SkillEffectHealingModifierDirection.DONE,
                    SkillEffectModifierOperation.DECREASE,
                    SkillEffectHealingKind.VAMP,
                    fortyPercentRule()
                )
            ))));
        assertField(done, "results[0].detail.direction", "DIRECTION_INVALID");
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void ratioMaxLockUsesCatalogModeAndAllowsDisabledRetainedReference() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        SkillEffectResultRequest result = healingModifierResult(
            "foo",
            SkillEffectHealingModifierDirection.RECEIVED,
            SkillEffectModifierOperation.DECREASE,
            SkillEffectHealingKind.ANY,
            fortyPercentRule()
        );
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(
                "foo", ModifierZoneDomain.HEALING, ModifierZoneCalculationMode.RATIO_MAX, ModifierZoneStatus.ENABLED)
        ));
        service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
            EFFECT_KEY, "重伤", null, 10, timedLifecycle(), List.of(result)
        ));

        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(
                "foo", ModifierZoneDomain.HEALING, ModifierZoneCalculationMode.RATIO_MAX, ModifierZoneStatus.DISABLED)
        ));
        SkillEffectDetailResponse updated = service.update(GAME_ID, SKILL_KEY, EFFECT_KEY, new SkillEffectUpdateRequest(
            null, "重伤", null, 10, timedLifecycle(), List.of(result)
        ));
        assertEquals("foo", ((SkillEffectHealingModifierDetail) updated.results().getFirst().detail()).modifierZoneKey());

        stubParentAndNewKey();
        ApiException disabledNew = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "新重伤", null, 10, timedLifecycle(), List.of(result))));
        assertEquals("409.SKILL_EFFECT_REFERENCE_DISABLED", disabledNew.getCode());
        assertField(disabledNew, "results[0].detail.modifierZoneKey", "MODIFIER_ZONE_DISABLED");
    }

    private static SkillEffectResultRequest healingModifierResult(
        String zoneKey,
        SkillEffectHealingModifierDirection direction,
        SkillEffectModifierOperation operation,
        SkillEffectHealingKind healingKind,
        SkillEffectValueRuleRequest valueRule
    ) {
        return new SkillEffectResultRequest(
            "healing_reduction",
            "治疗修正",
            SkillEffectResultType.HEALING_MODIFIER,
            SkillEffectTarget.SOURCE,
            null,
            1,
            valueRule,
            new SkillEffectHealingModifierDetail(zoneKey, direction, operation, healingKind),
            persistentShared()
        );
    }

    private static SkillEffectValueRuleRequest fortyPercentRule() {
        return new SkillEffectValueRuleRequest(SkillNumericValue.fixed(new BigDecimal("0.4")), BigDecimal.ONE, null, null);
    }

    @Test
    void listsRequiresParentAndReturnsSummaries() {
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.listSummaries(GAME_ID, SKILL_KEY)).thenReturn(List.of(summary()));

        List<SkillEffectSummaryResponse> items = service.list(GAME_ID, SKILL_KEY);
        assertEquals(1, items.size());
        assertEquals(EFFECT_KEY, items.get(0).effectKey());
        assertEquals(2, items.get(0).resultCount());
        assertEquals(false, items.get(0).lifecycleEnabled());

        when(gamesMapper.countGames("missing")).thenReturn(0L);
        assertCode("404.GAME_NOT_FOUND", () -> service.list("missing", SKILL_KEY));

        when(skillMapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.SKILL_NOT_FOUND", () -> service.list(GAME_ID, "missing"));
        verify(mapper, never()).listSummaries(eq(GAME_ID), eq("missing"));
    }

    @Test
    void createsSixNonShieldResultKindsAndReadsThemBack() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        stubDetailRead(sixNonShieldResultRows(), sixNonShieldValueRows(), sixNonShieldDetails());

        SkillEffectDetailResponse detail = service.create(GAME_ID, SKILL_KEY, createSixNonShieldResults());
        assertEquals(EFFECT_KEY, detail.effectKey());
        assertEquals(6, detail.results().size());
        assertEquals(SkillEffectResultType.DAMAGE, detail.results().get(0).resultType());
        assertInstanceOf(SkillEffectDamageDetail.class, detail.results().get(0).detail());
        assertEquals(SkillEffectResultType.DIRECT_HEAL, detail.results().get(1).resultType());
        assertInstanceOf(SkillEffectDirectHealDetail.class, detail.results().get(1).detail());
        assertEquals(SkillEffectResultType.ATTRIBUTE_CHANGE, detail.results().get(2).resultType());
        assertEquals(SkillEffectResultType.RESOURCE_CHANGE, detail.results().get(3).resultType());
        assertEquals(SkillEffectResultType.COOLDOWN_CHANGE, detail.results().get(4).resultType());
        assertEquals(SkillNumericValue.formula(FORMULA_KEY), detail.results().get(4).valueRule().value());
        assertEquals(SkillEffectResultType.STATUS_OPERATION, detail.results().get(5).resultType());
        assertNull(detail.results().get(5).valueRule());

        InOrder order = inOrder(skillMapper, mapper);
        order.verify(skillMapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(mapper).lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection());
        order.verify(mapper).lockDamageTypes(eq(GAME_ID), anyCollection());
        order.verify(mapper).lockAttributes(eq(GAME_ID), anyCollection());
        order.verify(mapper).lockSkills(eq(GAME_ID), anyCollection());
        order.verify(mapper).lockStatuses(eq(GAME_ID), anyCollection());
        order.verify(mapper).insertEffect(eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("命中结果"), isNull(), eq(10), any(), any());
    }

    @Test
    void createsPersistentSpellShieldAndBlockableDamage() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        SkillEffectResultRow shieldRow = new SkillEffectResultRow(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "spell_shield", "法术护盾",
            SkillEffectResultType.SPELL_SHIELD, SkillEffectTarget.SOURCE, null, 0
        );
        SkillEffectResultRow damageRow = resultRow("physical_hit", SkillEffectResultType.DAMAGE);
        stubDetailRead(
            List.of(shieldRow, damageRow),
            List.of(valueRow("physical_hit")),
            new DetailBundle(
                List.of(new SkillEffectDamageDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical",
                    SkillEffectDamageDeliveryKind.SKILL, SkillEffectDamageOriginKind.DIRECT
                )),
                List.of(), List.of(), List.of(), List.of()
            )
        );
        fixture.put("findLifecycle", lifecycleRow());
        fixture.put("listLifecycleBehaviors", List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "spell_shield",
                SkillEffectLifecycleMoment.PERSISTENT, null, null, null, null
            ),
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                null, null, null
            )
        ));
        fixture.put("listSpellShieldPolicies", List.of(
            new SkillEffectSpellShieldPolicyRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE
            )
        ));

        SkillEffectResultRequest shield = new SkillEffectResultRequest(
            "spell_shield", "法术护盾", SkillEffectResultType.SPELL_SHIELD,
            SkillEffectTarget.SOURCE, null, 0, null, new SkillEffectSpellShieldDetail(),
            new SkillEffectResultLifecycleBehaviorRequest(
                SkillEffectLifecycleMoment.PERSISTENT, null, null, null, null
            ),
            null
        );
        SkillEffectResultRequest damage = damageResult("physical_hit");
        damage = new SkillEffectResultRequest(
            damage.resultKey(), damage.name(), damage.resultType(), damage.target(),
            damage.description(), damage.sortOrder(), damage.valueRule(), damage.detail(),
            applicationSnapshot(), SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE
        );

        SkillEffectDetailResponse response = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY, "法术护盾", null, 10, timedLifecycle(), List.of(shield, damage)
            )
        );

        assertEquals(List.of("physical_hit", "spell_shield"), response.results().stream()
            .map(result -> result.resultKey()).toList());
        assertInstanceOf(SkillEffectSpellShieldDetail.class, response.results().get(1).detail());
        assertEquals(
            SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE,
            response.results().get(0).spellShieldBlockScope()
        );
    }

    @Test
    void rejectsDamageInstanceScopeForNonDamageResult() {
        stubParentAndNewKey();
        SkillEffectResultRequest result = new SkillEffectResultRequest(
            "slow", "减速", SkillEffectResultType.ATTRIBUTE_CHANGE,
            SkillEffectTarget.TARGET, null, 0, valueRule(),
            new SkillEffectAttributeChangeDetail("move_speed", SkillEffectAttributeChangeOperation.DECREASE),
            null,
            SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE
        );

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "减速", null, 0, List.of(result))
            )
        );

        assertField(
            exception,
            "results[0].spellShieldBlockScope",
            "INVALID_SPELL_SHIELD_SCOPE"
        );
    }

    @Test
    void createsExecuteAndLinkResultsAndRejectsPersistentDamageInstanceAndModifierZone() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        List<SkillEffectResultRow> rows = List.of(
            new SkillEffectResultRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "execute", "斩杀",
                SkillEffectResultType.EXECUTE, SkillEffectTarget.TARGET, null, 0
            ),
            new SkillEffectResultRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "hit_link", "命中联动",
                SkillEffectResultType.HIT_LINK_APPLICATION, SkillEffectTarget.TARGET, null, 1
            ),
            new SkillEffectResultRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "attack_link", "攻击联动",
                SkillEffectResultType.ATTACK_LINK_APPLICATION, SkillEffectTarget.TARGET, null, 2
            )
        );
        stubDetailRead(
            rows,
            List.of(valueRow("execute"), valueRow("hit_link"), valueRow("attack_link")),
            new DetailBundle(List.of(), List.of(), List.of(), List.of(), List.of())
        );
        fixture.put("listExecuteDetails", List.of(
            new SkillEffectExecuteDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "execute", "hp")
        ));
        fixture.put("listLifecycleBehaviors", List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "execute",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT, null, null, null
            ),
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "hit_link",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT, null, null, null
            ),
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "attack_link",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT, null, null, null
            )
        ));
        fixture.put("listSpellShieldPolicies", List.of(
            new SkillEffectSpellShieldPolicyRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "execute", SkillEffectSpellShieldBlockScope.RESULT
            )
        ));

        fixture.put("findLifecycle", lifecycleRow());

        SkillEffectDetailResponse created = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY, "斩杀联动", null, 10, timedLifecycle(),
                List.of(
                    new SkillEffectResultRequest(
                        "execute", "斩杀", SkillEffectResultType.EXECUTE, SkillEffectTarget.TARGET,
                        null, 0, valueRule(), new SkillEffectExecuteDetail("hp"),
                        applicationSnapshot(), SkillEffectSpellShieldBlockScope.RESULT
                    ),
                    new SkillEffectResultRequest(
                        "hit_link", "命中联动", SkillEffectResultType.HIT_LINK_APPLICATION,
                        SkillEffectTarget.TARGET, null, 1, valueRule(),
                        new SkillEffectHitLinkApplicationDetail(), applicationSnapshot()
                    ),
                    new SkillEffectResultRequest(
                        "attack_link", "攻击联动", SkillEffectResultType.ATTACK_LINK_APPLICATION,
                        SkillEffectTarget.TARGET, null, 2, valueRule(),
                        new SkillEffectAttackLinkApplicationDetail(), applicationSnapshot()
                    )
                )
            )
        );
        assertInstanceOf(SkillEffectExecuteDetail.class, created.results().get(0).detail());
        assertEquals("hp", ((SkillEffectExecuteDetail) created.results().get(0).detail()).attributeKey());
        assertInstanceOf(SkillEffectHitLinkApplicationDetail.class, created.results().get(1).detail());
        assertInstanceOf(SkillEffectAttackLinkApplicationDetail.class, created.results().get(2).detail());
        assertEquals(SkillEffectSpellShieldBlockScope.RESULT, created.results().get(0).spellShieldBlockScope());

        ApiException persistent = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(
                    "persist_execute", "斩杀", null, 0, timedLifecycle(),
                    List.of(new SkillEffectResultRequest(
                        "execute", "斩杀", SkillEffectResultType.EXECUTE, SkillEffectTarget.TARGET,
                        null, 0, valueRule(), new SkillEffectExecuteDetail("hp"),
                        new SkillEffectResultLifecycleBehaviorRequest(
                            SkillEffectLifecycleMoment.PERSISTENT,
                            SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                            SkillEffectLifecycleStackValueMode.SHARED,
                            SkillEffectLifecycleReapplicationValueMode.KEEP,
                            null
                        )
                    ))
                )
            )
        );
        assertField(persistent, "results[0].lifecycleBehavior.moment", "SPECIAL_RESULT_FORBIDS_PERSISTENT");

        ApiException damageInstance = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(
                    "blocked_execute", "斩杀", null, 0,
                    List.of(new SkillEffectResultRequest(
                        "execute", "斩杀", SkillEffectResultType.EXECUTE, SkillEffectTarget.TARGET,
                        null, 0, valueRule(), new SkillEffectExecuteDetail("hp"),
                        null, SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE
                    ))
                )
            )
        );
        assertField(damageInstance, "results[0].spellShieldBlockScope", "INVALID_SPELL_SHIELD_SCOPE");

        ApiException sourceTarget = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(
                    "source_link", "命中联动", null, 0,
                    List.of(new SkillEffectResultRequest(
                        "hit_link", "命中联动", SkillEffectResultType.HIT_LINK_APPLICATION,
                        SkillEffectTarget.SOURCE, null, 0, valueRule(),
                        new SkillEffectHitLinkApplicationDetail(),
                        null, SkillEffectSpellShieldBlockScope.SKILL
                    ))
                )
            )
        );
        assertField(sourceTarget, "results[0].spellShieldBlockScope", "INVALID_SPELL_SHIELD_SCOPE");

        ApiException modifierZone = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(
                    "zone_link", "命中联动", null, 0,
                    List.of(new SkillEffectResultRequest(
                        "hit_link", "命中联动", SkillEffectResultType.HIT_LINK_APPLICATION,
                        SkillEffectTarget.TARGET, null, 0, valueRule(),
                        new SkillEffectHitLinkApplicationDetail(Set.of("modifierZoneKey"), Set.of())
                    ))
                )
            )
        );
        assertField(modifierZone, "results[0].detail.modifierZoneKey", "FIELD_MUTEX");
    }

    @Test
    void createsFourPersistentModifierAndProtectionResultsAndReadsThemBack() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        List<SkillEffectResultRow> rows = List.of(
            resultRow("damage_reduction", SkillEffectResultType.DAMAGE_MODIFIER),
            resultRow("healing_reduction", SkillEffectResultType.HEALING_MODIFIER),
            resultRow("damage_immunity", SkillEffectResultType.DAMAGE_IMMUNITY),
            resultRow("health_floor", SkillEffectResultType.HEALTH_FLOOR)
        );
        stubDetailRead(
            rows,
            List.of(
                valueRow("damage_reduction"),
                valueRow("healing_reduction"),
                valueRow("health_floor")
            ),
            new DetailBundle(List.of(), List.of(), List.of(), List.of(), List.of())
        );
        fixture.put("findLifecycle", lifecycleRow());
        fixture.put("listLifecycleBehaviors", rows.stream().map(row -> new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                row.resultKey(),
                SkillEffectLifecycleMoment.PERSISTENT,
                row.resultType() == SkillEffectResultType.DAMAGE_IMMUNITY
                    ? null
                    : SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                row.resultType() == SkillEffectResultType.DAMAGE_IMMUNITY
                    ? null
                    : SkillEffectLifecycleStackValueMode.SHARED,
                row.resultType() == SkillEffectResultType.DAMAGE_IMMUNITY
                    ? null
                    : SkillEffectLifecycleReapplicationValueMode.KEEP,
                null
            )).toList());
        fixture.put("listDamageModifierDetails", List.of(
            new SkillEffectDamageModifierDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "damage_reduction",
                DAMAGE_ZONE_KEY,
                SkillEffectDamageModifierDirection.TAKEN,
                SkillEffectModifierOperation.DECREASE,
                "physical",
                SkillEffectDamageFilterDeliveryKind.ANY,
                SkillEffectDamageFilterOriginKind.DIRECT,
                SkillEffectCriticalFilter.ANY
            )
        ));
        fixture.put("listHealingModifierDetails", List.of(
            new SkillEffectHealingModifierDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "healing_reduction",
                HEALING_ZONE_KEY,
                SkillEffectHealingModifierDirection.RECEIVED,
                SkillEffectModifierOperation.DECREASE,
                SkillEffectHealingKind.ANY
            )
        ));
        fixture.put("listDamageImmunityDetails", List.of(
            new SkillEffectDamageImmunityDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "damage_immunity", null,
                SkillEffectDamageFilterDeliveryKind.SKILL,
                SkillEffectDamageFilterOriginKind.ANY
            )
        ));
        fixture.put("listHealthFloorDetails", List.of(
            new SkillEffectHealthFloorDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "health_floor", "hp"
            )
        ));

        SkillEffectDetailResponse detail = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "持续修正",
                null,
                10,
                timedLifecycle(),
                List.of(
                    persistentDamageModifierResult(),
                    persistentHealingModifierResult(),
                    persistentDamageImmunityResult(),
                    persistentHealthFloorResult()
                )
            )
        );

        assertEquals(4, detail.results().size());
        assertInstanceOf(SkillEffectDamageModifierDetail.class, detail.results().get(0).detail());
        assertInstanceOf(SkillEffectHealingModifierDetail.class, detail.results().get(1).detail());
        assertInstanceOf(SkillEffectDamageImmunityDetail.class, detail.results().get(2).detail());
        assertInstanceOf(SkillEffectHealthFloorDetail.class, detail.results().get(3).detail());
        assertNull(detail.results().get(2).valueRule());
    }

    @Test
    void damageModifierConditionRoundTripsThroughAggregate() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(DAMAGE_ZONE_KEY, ModifierZoneDomain.DAMAGE,
                ModifierZoneCalculationMode.RATIO_ADD, ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE,
                ModifierZoneStatus.ENABLED)));
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        var condition = AggregateJson.tree("""
            {"receiver":"ENEMY_CHAMPION","attributeKey":"hp","attributeValueKind":"CURRENT_RATIO",
             "comparator":"LT","comparisonValue":{"kind":"FIXED","value":0.4}}
            """);
        SkillEffectDetailResponse saved = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
            EFFECT_KEY, "致命一击", null, 0, timedLifecycle(), List.of(conditionedModifier(condition,
                SkillEffectTarget.SOURCE, SkillEffectDamageModifierDirection.DEALT))));
        var savedCondition = ((SkillEffectDamageModifierDetail) saved.results().getFirst().detail()).condition();
        assertEquals("hp", savedCondition.path("attributeKey").asText());
        assertEquals(0, savedCondition.path("comparisonValue").path("value").decimalValue()
            .compareTo(new BigDecimal("0.4")));
        assertEquals(savedCondition, ((SkillEffectDamageModifierDetail)
            SkillEffectAggregate.readResults(savedEffect.results()).getFirst().detail()).condition());
    }

    @Test
    void unconditionedDamageModifierKeepsTargetTakenAndPostDefenseZone() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(DAMAGE_ZONE_KEY, ModifierZoneDomain.DAMAGE,
                ModifierZoneCalculationMode.RATIO_ADD, ModifierZoneApplicationStage.DAMAGE_POST_DEFENSE,
                ModifierZoneStatus.ENABLED)));
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        SkillEffectDetailResponse saved = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
            EFFECT_KEY, "无条件受伤修正", null, 0, timedLifecycle(), List.of(
                conditionedModifier(null, SkillEffectTarget.TARGET, SkillEffectDamageModifierDirection.TAKEN))));
        var detail = (SkillEffectDamageModifierDetail) saved.results().getFirst().detail();
        assertNull(detail.condition());
        assertEquals(SkillEffectDamageFilterDeliveryKind.ANY, detail.deliveryKind());
        assertEquals(SkillEffectDamageFilterOriginKind.DIRECT, detail.originKind());
    }

    @Test
    void damageModifierConditionRejectsUnknownFieldWrongScopeAndStage() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(DAMAGE_ZONE_KEY, ModifierZoneDomain.DAMAGE,
                ModifierZoneCalculationMode.RATIO_ADD, ModifierZoneApplicationStage.DAMAGE_POST_DEFENSE,
                ModifierZoneStatus.ENABLED)));
        var malformed = AggregateJson.tree("""
            {"receiver":"ENEMY_CHAMPION","attributeKey":"hp","attributeValueKind":"CURRENT_RATIO",
             "comparator":"LT","comparisonValue":{"kind":"FIXED","value":0.4},"unknown":true}
            """);
        ApiException shape = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "门槛", null, 0, timedLifecycle(), List.of(
                conditionedModifier(malformed, SkillEffectTarget.TARGET, SkillEffectDamageModifierDirection.TAKEN)))));
        assertField(shape, "results[0].detail.condition.unknown", "UNKNOWN_FIELD");
        assertField(shape, "results[0].target", "CONDITION_TARGET_UNSUPPORTED");
        assertField(shape, "results[0].detail.direction", "CONDITION_DIRECTION_UNSUPPORTED");

        ApiException nested = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "门槛", null, 0, timedLifecycle(), List.of(
                conditionedModifier(AggregateJson.tree("""
                    {"receiver":"ENEMY_CHAMPION","attributeKey":"hp","attributeValueKind":"CURRENT_RATIO",
                     "comparator":"LTE","comparisonValue":{"kind":"FIXED","value":0.4,"extra":true}}
                    """), SkillEffectTarget.SOURCE, SkillEffectDamageModifierDirection.DEALT)))));
        assertField(nested, "results[0].detail.condition.comparator", "INVALID_VALUE");
        assertField(nested, "results[0].detail.condition.comparisonValue", "VALUE_SHAPE_INVALID");

        ApiException notObject = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "门槛", null, 0, timedLifecycle(), List.of(
                conditionedModifier(AggregateJson.tree("[]"), SkillEffectTarget.SOURCE,
                    SkillEffectDamageModifierDirection.DEALT)))));
        assertField(notObject, "results[0].detail.condition", "TYPE_MISMATCH");

        var valid = AggregateJson.tree("""
            {"receiver":"ENEMY_CHAMPION","attributeKey":"hp","attributeValueKind":"CURRENT_RATIO",
             "comparator":"GT","comparisonValue":{"kind":"FIXED","value":0.6}}
            """);
        ApiException stage = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "门槛", null, 0, timedLifecycle(), List.of(
                conditionedModifier(valid, SkillEffectTarget.SOURCE, SkillEffectDamageModifierDirection.DEALT)))));
        assertField(stage, "results[0].detail.modifierZoneKey", "MODIFIER_ZONE_STAGE_INVALID");
    }

    @Test
    void persistentModifierRequiresMatchingEnabledZone() {
        stubParentAndNewKey();
        SkillEffectResultRequest source = persistentDamageModifierResult();
        SkillEffectDamageModifierDetail detail = (SkillEffectDamageModifierDetail) source.detail();
        SkillEffectResultRequest withoutZone = new SkillEffectResultRequest(
            source.resultKey(), source.name(), source.resultType(), source.target(), source.description(),
            source.sortOrder(), source.valueRule(),
            new SkillEffectDamageModifierDetail(
                detail.direction(), detail.operation(), detail.damageTypeKey(), detail.deliveryKind(),
                detail.originKind(), detail.criticalFilter()
            ),
            source.lifecycleBehavior()
        );

        ApiException missing = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "持续修正", null, 0, timedLifecycle(), List.of(withoutZone)
                )
            )
        );
        assertField(missing, "results[0].detail.modifierZoneKey", "REQUIRED");

        stubParentAndNewKey();
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of(FORMULA_KEY));
        when(mapper.lockDamageTypes(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectCatalogLockRow("physical", "ENABLED")
        ));
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectModifierZoneLockRow(
                DAMAGE_ZONE_KEY,
                ModifierZoneDomain.HEALING,
                ModifierZoneCalculationMode.RATIO_ADD,
                ModifierZoneStatus.ENABLED
            )
        ));

        ApiException mismatched = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "持续修正", null, 0, timedLifecycle(), List.of(source)
                )
            )
        );
        assertField(mismatched, "results[0].detail.modifierZoneKey", "MODIFIER_ZONE_DOMAIN_MISMATCH");
    }

    @Test
    void momentEvaluationAllowsSharedWithoutMergeAndRejectsRuntimeInputFormula() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.listRuntimeInputFormulaKeys(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(FORMULA_KEY));
        SkillEffectResultRequest source = persistentDamageModifierResult();
        SkillEffectResultRequest dynamic = new SkillEffectResultRequest(
            source.resultKey(), source.name(), source.resultType(), source.target(), source.description(),
            source.sortOrder(), source.valueRule(), source.detail(),
            new SkillEffectResultLifecycleBehaviorRequest(
                SkillEffectLifecycleMoment.PERSISTENT,
                SkillEffectLifecycleValueReadMode.MOMENT_EVALUATION,
                SkillEffectLifecycleStackValueMode.SHARED,
                null,
                null
            )
        );

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "动态修正", null, 0, timedLifecycle(), List.of(dynamic)
                )
            )
        );

        assertField(exception, "results[0].valueRule.value", "RUNTIME_INPUT_FORBIDDEN");
    }

    @Test
    void createsDamageCriticalAndVampOverridesAndReadsCanonicalShape() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        List<SkillEffectResultRow> results = List.of(resultRow("physical_hit", SkillEffectResultType.DAMAGE));
        stubDetailRead(
            results,
            List.of(valueRow("physical_hit")),
            new DetailBundle(
                List.of(new SkillEffectDamageDetailRow(
                    GAME_ID,
                    SKILL_KEY,
                    EFFECT_KEY,
                    "physical_hit",
                    "physical",
                    SkillEffectDamageDeliveryKind.SKILL,
                    SkillEffectDamageOriginKind.DIRECT
                )),
                List.of(), List.of(), List.of(), List.of()
            )
        );
        fixture.put("listCriticalPolicies", List.of(
            new SkillEffectCriticalPolicyRow(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                "physical_hit",
                SkillEffectCriticalMode.SOURCE_CRIT_CHANCE,
                SkillNumericValue.formula("crit_multiplier")
            )
        ));
        fixture.put("listVampOverrides", List.of(
            new SkillEffectVampOverrideRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectVampType.LIFE_STEAL, xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE,
                SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE,
                SkillNumericValue.formula("life_steal_efficiency")
            ),
            new SkillEffectVampOverrideRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectVampType.OMNIVAMP, xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE,
                SkillEffectVampBasisOutputKind.ACTUAL_HP_LOSS,
                SkillNumericValue.formula("omnivamp_efficiency")
            )
        ));

        SkillEffectDamageDetail requestDetail = new SkillEffectDamageDetail(
            "physical",
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.DIRECT,
            new SkillEffectCriticalPolicy(SkillEffectCriticalMode.SOURCE_CRIT_CHANCE, SkillNumericValue.formula("crit_multiplier")), xyz.game.datamanage.model.skilleffect.SkillEffectVampQualification.RESOLVED,
            List.of(
                new SkillEffectVampOverride(
                    SkillEffectVampType.LIFE_STEAL, xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE,
                    SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE,
                    SkillNumericValue.formula("life_steal_efficiency")
                ),
                new SkillEffectVampOverride(
                    SkillEffectVampType.OMNIVAMP, xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE,
                    SkillEffectVampBasisOutputKind.ACTUAL_HP_LOSS,
                    SkillNumericValue.formula("omnivamp_efficiency")
                )
            )
        );
        SkillEffectDetailResponse response = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "命中结果",
                null,
                10,
                List.of(new SkillEffectResultRequest(
                    "physical_hit",
                    "物理伤害",
                    SkillEffectResultType.DAMAGE,
                    SkillEffectTarget.TARGET,
                    null,
                    0,
                    valueRule(),
                    requestDetail
                ))
            )
        );

        SkillEffectDamageDetail saved = (SkillEffectDamageDetail) response.results().get(0).detail();
        assertEquals(SkillEffectCriticalMode.SOURCE_CRIT_CHANCE, saved.critical().mode());
        assertEquals(SkillNumericValue.formula("crit_multiplier"), saved.critical().multiplierValue());
        assertEquals(2, saved.vampOverrides().size());
        assertEquals(SkillEffectVampType.LIFE_STEAL, saved.vampOverrides().get(0).vampType());
        assertEquals(SkillEffectVampType.OMNIVAMP, saved.vampOverrides().get(1).vampType());
    }

    @Test
    void rejectsInvalidCriticalShapeAndDuplicateVampTypeBeforeWrite() {
        stubParentAndNewKey();
        SkillEffectDamageDetail invalid = new SkillEffectDamageDetail(
            "physical",
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.DIRECT,
            new SkillEffectCriticalPolicy(SkillEffectCriticalMode.DISALLOWED, SkillNumericValue.formula("crit_multiplier")), xyz.game.datamanage.model.skilleffect.SkillEffectVampQualification.RESOLVED,
            List.of(
                new SkillEffectVampOverride(
                    SkillEffectVampType.LIFE_STEAL, xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE,
                    SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE,
                    SkillNumericValue.formula("life_steal_efficiency")
                ),
                new SkillEffectVampOverride(
                    SkillEffectVampType.LIFE_STEAL, xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE,
                    SkillEffectVampBasisOutputKind.ACTUAL_HP_LOSS,
                    SkillNumericValue.formula("other_efficiency")
                )
            )
        );

        ApiException exception = assertThrows(ApiException.class, () -> service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "命中结果",
                null,
                10,
                List.of(new SkillEffectResultRequest(
                    "physical_hit",
                    "物理伤害",
                    SkillEffectResultType.DAMAGE,
                    SkillEffectTarget.TARGET,
                    null,
                    0,
                    valueRule(),
                    invalid
                ))
            )
        ));

        assertEquals("400.VALIDATION_FAILED", exception.getCode());
        assertField(exception, "results[0].detail.critical.multiplierValue", "INVALID_CRITICAL_SHAPE");
        assertField(exception, "results[0].detail.vampOverrides[1].vampType", "DUPLICATE_VAMP_TYPE");
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void updateAppliesFullDiffKeepInsertDeleteAndCooldownValueToggle() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE),
            resultRow("direct_heal", SkillEffectResultType.DIRECT_HEAL),
            resultRow("reduce_self", SkillEffectResultType.COOLDOWN_CHANGE)
        ));
        fixture.put("listValues", List.of(valueRow("physical_hit"), valueRow("direct_heal"), valueRow("reduce_self")));
        fixture.put("listDamageDetails", List.of(new SkillEffectDamageDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
            )));
        fixture.put("listCriticalPolicies", List.of(new SkillEffectCriticalPolicyRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectCriticalMode.DISALLOWED, null
            )));
        fixture.put("listVampOverrides", List.of());
        fixture.put("listNormalShieldInteractions", List.of());
        fixture.put("listAttributeChangeDetails", List.of());
        fixture.put("listResourceChangeDetails", List.of());
        fixture.put("listCooldownChangeDetails", List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SkillEffectCooldownChangeOperation.RESET
            )));
        fixture.put("listSkillScopes", List.of(new SkillEffectSkillScopeRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SkillEffectSkillScopeMode.SKILLS
            )));
        fixture.put("listSkillTargets", List.of(new SkillEffectSkillTargetRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SKILL_KEY
            )));
        fixture.put("listStatusOperationDetails", List.of());
        stubEnabledCatalogs();

        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> readEffect());
        fixture.put("listResults", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE),
            resultRow("reduce_self", SkillEffectResultType.COOLDOWN_CHANGE),
            resultRow("apply_poison", SkillEffectResultType.STATUS_OPERATION)
        ));

        SkillEffectDetailResponse detail = service.update(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            new SkillEffectUpdateRequest(
                null,
                "命中结果",
                null,
                10,
                List.of(
                    damageResult("physical_hit"),
                    cooldownResetResult("reduce_self", SKILL_KEY),
                    statusResult("apply_poison")
                )
            )
        );
        assertEquals(3, detail.results().size());
        assertNull(detail.results().get(1).valueRule());
        assertEquals(SkillEffectCooldownChangeOperation.RESET,
            ((SkillEffectCooldownChangeDetail) detail.results().get(1).detail()).operation());

        verify(mapper).updateEffect(eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("命中结果"), eq(null), eq(10), any(), any());
    }

    @Test
    void createFailsClosedWhenInsertThrows() {
        stubParentAndNewKey();
        stubEnabledCatalogs();

        when(mapper.insertEffect(any(), any(), any(), any(), any(), any(), any(), any())).thenThrow(new DataIntegrityViolationException("insert failed"));

        assertThrows(
            DataIntegrityViolationException.class,
            () -> service.create(GAME_ID, SKILL_KEY, createDamageOnly())
        );
        verify(mapper).insertEffect(eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), any(), any(), any(), any(), any());
        verify(mapper, never()).findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY);
    }

    @Test
    void rejectsEmptyResultsDuplicateKeysAndImmutableResultType() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());

        ApiException empty = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "空结果", null, 0, List.of())
            )
        );
        assertEquals("400.VALIDATION_FAILED", empty.getCode());
        assertField(empty, "results", "REQUIRED");

        ApiException duplicate = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "重复键",
                    null,
                    0,
                    List.of(damageResult("physical_hit"), damageResult("physical_hit"))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", duplicate.getCode());
        assertField(duplicate, "results[1].resultKey", "DUPLICATE");

        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        ApiException immutable = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null,
                    "命中结果",
                    null,
                    10,
                    List.of(healResult("physical_hit"))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", immutable.getCode());
        assertField(immutable, "results[0].resultType", "IMMUTABLE");
        verify(mapper, never()).updateEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsInvalidValueRules() {
        stubEnabledCatalogs();
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());

        ApiException missing = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "缺数值",
                    null,
                    0,
                    List.of(new SkillEffectResultRequest(
                        "physical_hit",
                        "物理伤害",
                        SkillEffectResultType.DAMAGE,
                        SkillEffectTarget.TARGET,
                        null,
                        0,
                        null,
                        new SkillEffectDamageDetail("physical")
                    ))
                )
            )
        );
        assertField(missing, "results[0].valueRule", "REQUIRED");

        ApiException negative = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "负倍率",
                    null,
                    0,
                    List.of(new SkillEffectResultRequest(
                        "physical_hit",
                        "物理伤害",
                        SkillEffectResultType.DAMAGE,
                        SkillEffectTarget.TARGET,
                        null,
                        0,
                        new SkillEffectValueRuleRequest(
                            SkillNumericValue.formula(FORMULA_KEY), new BigDecimal("-1"), null, null
                        ),
                        new SkillEffectDamageDetail("physical")
                    ))
                )
            )
        );
        assertField(negative, "results[0].valueRule.fixedMultiplier", "RANGE_INVALID");

        ApiException bounds = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "上下限",
                    null,
                    0,
                    List.of(new SkillEffectResultRequest(
                        "physical_hit",
                        "物理伤害",
                        SkillEffectResultType.DAMAGE,
                        SkillEffectTarget.TARGET,
                        null,
                        0,
                        new SkillEffectValueRuleRequest(
                            SkillNumericValue.formula(FORMULA_KEY), BigDecimal.ONE, new BigDecimal("10"), new BigDecimal("1")
                        ),
                        new SkillEffectDamageDetail("physical")
                    ))
                )
            )
        );
        assertField(bounds, "results[0].valueRule.fixedMinValue", "RANGE_INVALID");

        ApiException forbidden = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "状态带数值",
                    null,
                    0,
                    List.of(new SkillEffectResultRequest(
                        "apply_poison",
                        "施加中毒",
                        SkillEffectResultType.STATUS_OPERATION,
                        SkillEffectTarget.TARGET,
                        null,
                        0,
                        new SkillEffectValueRuleRequest(SkillNumericValue.formula(FORMULA_KEY), BigDecimal.ONE, null, null),
                        new SkillEffectStatusOperationDetail("poison", SkillEffectStatusOperation.APPLY)
                    ))
                )
            )
        );
        assertField(forbidden, "results[0].valueRule", "FORBIDDEN");
    }

    @Test
    void aggregatesAllUnknownReferencesInOneResponse() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        when(mapper.lockDamageTypes(eq(GAME_ID), anyCollection())).thenReturn(List.of());
        when(mapper.lockAttributes(eq(GAME_ID), anyCollection())).thenReturn(List.of());
        when(mapper.lockSkills(eq(GAME_ID), anyCollection())).thenReturn(List.of());
        when(mapper.lockStatuses(eq(GAME_ID), anyCollection())).thenReturn(List.of());

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "未知引用",
                    null,
                    0,
                    List.of(
                        damageResult("physical_hit"),
                        attributeResult("buff_ad"),
                        cooldownReduceResult("reduce_other", "other_skill"),
                        statusResult("apply_poison")
                    )
                )
            )
        );
        assertEquals("400.INVALID_SKILL_EFFECT_REFERENCE", exception.getCode());
        List<Map<String, String>> issues = fieldIssues(exception);
        assertEquals(7, issues.size());
        assertTrue(issues.stream().anyMatch(issue ->
            "results[0].valueRule.value".equals(issue.get("field"))
                && "UNKNOWN_FORMULA".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[0].detail.damageTypeKey".equals(issue.get("field"))
                && "UNKNOWN_DAMAGE_TYPE".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[1].valueRule.value".equals(issue.get("field"))
                && "UNKNOWN_FORMULA".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[1].detail.attributeKey".equals(issue.get("field"))
                && "UNKNOWN_ATTRIBUTE".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[2].valueRule.value".equals(issue.get("field"))
                && "UNKNOWN_FORMULA".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[2].detail.affectedSkillScope.skillKeys[0]".equals(issue.get("field"))
                && "UNKNOWN_SKILL".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[3].detail.statusKey".equals(issue.get("field"))
                && "UNKNOWN_STATUS".equals(issue.get("code"))
        ));
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsCrossGameAndCrossSkillFormulaByUnknownFormula() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        when(mapper.lockDamageTypes(eq(GAME_ID), anyCollection()))
            .thenReturn(List.of(new SkillEffectCatalogLockRow("physical", "ENABLED")));

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, SKILL_KEY, createDamageOnly())
        );
        assertEquals("400.INVALID_SKILL_EFFECT_REFERENCE", exception.getCode());
        assertField(exception, "results[0].valueRule.value", "UNKNOWN_FORMULA");
        verify(mapper).lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection());
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsNewDisabledReferencesAndKeepsRetainedDisabled() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(FORMULA_KEY));
        when(mapper.lockDamageTypes(eq(GAME_ID), anyCollection()))
            .thenReturn(List.of(new SkillEffectCatalogLockRow("physical", "DISABLED")));

        ApiException created = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, SKILL_KEY, createDamageOnly())
        );
        assertEquals("409.SKILL_EFFECT_REFERENCE_DISABLED", created.getCode());
        assertField(created, "results[0].detail.damageTypeKey", "DAMAGE_TYPE_DISABLED");
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());

        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("listValues", List.of(valueRow("physical_hit")));
        fixture.put("listDamageDetails", List.of(
            new SkillEffectDamageDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical")
        ));
        fixture.put("listAttributeChangeDetails", List.of());
        fixture.put("listResourceChangeDetails", List.of());
        fixture.put("listCooldownChangeDetails", List.of());
        fixture.put("listStatusOperationDetails", List.of());

        stubDetailRead(
            List.of(resultRow("physical_hit", SkillEffectResultType.DAMAGE)),
            List.of(valueRow("physical_hit")),
            new DetailBundle(
                List.of(new SkillEffectDamageDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
                )),
                List.of(),
                List.of(),
                List.of(),
                List.of()
            )
        );

        SkillEffectDetailResponse kept = service.update(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            new SkillEffectUpdateRequest(null, "命中结果", null, 10, List.of(damageResult("physical_hit")))
        );
        assertEquals("physical", ((SkillEffectDamageDetail) kept.results().get(0).detail()).damageTypeKey());
    }

    @Test
    void disabledParentSkillAllowsSelfCooldownOnCreateAndUpdateButRejectsOtherDisabledSkill() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(disabledSkill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(FORMULA_KEY));
        when(mapper.lockSkills(eq(GAME_ID), anyCollection()))
            .thenReturn(List.of(new SkillEffectCatalogLockRow(SKILL_KEY, "DISABLED")));

        stubDetailRead(
            List.of(resultRow("reduce_self", SkillEffectResultType.COOLDOWN_CHANGE)),
            List.of(valueRow("reduce_self")),
            new DetailBundle(
                List.of(),
                List.of(),
                List.of(),
                List.of(new SkillEffectCooldownChangeDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SkillEffectCooldownChangeOperation.REDUCE
                )),
                List.of()
            )
        );

        SkillEffectDetailResponse created = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "自身冷却",
                null,
                0,
                List.of(cooldownReduceResult("reduce_self", SKILL_KEY))
            )
        );
        assertEquals(List.of(SKILL_KEY),
            ((SkillEffectCooldownChangeDetail) created.results().get(0).detail()).affectedSkillScope().skillKeys());

        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of());
        fixture.put("listValues", List.of());
        fixture.put("listDamageDetails", List.of());
        fixture.put("listAttributeChangeDetails", List.of());
        fixture.put("listResourceChangeDetails", List.of());
        fixture.put("listCooldownChangeDetails", List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SkillEffectCooldownChangeOperation.REDUCE
            )));
        fixture.put("listStatusOperationDetails", List.of());

        SkillEffectDetailResponse updated = service.update(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            new SkillEffectUpdateRequest(
                null,
                "自身冷却",
                null,
                0,
                List.of(cooldownReduceResult("reduce_self", SKILL_KEY))
            )
        );
        assertEquals(List.of(SKILL_KEY),
            ((SkillEffectCooldownChangeDetail) updated.results().get(0).detail()).affectedSkillScope().skillKeys());

        when(mapper.lockSkills(eq(GAME_ID), anyCollection()))
            .thenReturn(List.of(new SkillEffectCatalogLockRow("other_skill", "DISABLED")));
        ApiException other = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null,
                    "其他停用技能",
                    null,
                    0,
                    List.of(cooldownReduceResult("reduce_other", "other_skill"))
                )
            )
        );
        assertEquals("409.SKILL_EFFECT_REFERENCE_DISABLED", other.getCode());
        assertField(other, "results[0].detail.affectedSkillScope.skillKeys[0]", "SKILL_DISABLED");
    }

    @Test
    void cooldownChangePersistsOneResultWithMultipleOrderedTargets() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        stubDetailRead(
            List.of(resultRow("reduce_abilities", SkillEffectResultType.COOLDOWN_CHANGE)),
            List.of(valueRow("reduce_abilities")),
            new DetailBundle(
                List.of(),
                List.of(),
                List.of(),
                List.of(new SkillEffectCooldownChangeDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", SkillEffectCooldownChangeOperation.REDUCE
                )),
                List.of()
            )
        );
        fixture.put("listSkillScopes", List.of(
            new SkillEffectSkillScopeRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", SkillEffectSkillScopeMode.SKILLS
            )
        ));
        fixture.put("listSkillTargets", List.of(
            new SkillEffectSkillTargetRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", "ezreal_w"),
            new SkillEffectSkillTargetRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", SKILL_KEY),
            new SkillEffectSkillTargetRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", "ezreal_r")
        ));
        SkillEffectDetailResponse existing = service.get(GAME_ID, SKILL_KEY, EFFECT_KEY);
        assertEquals(List.of("ezreal_w", SKILL_KEY, "ezreal_r"),
            ((SkillEffectCooldownChangeDetail) existing.results().get(0).detail()).affectedSkillScope().skillKeys());

        SkillEffectDetailResponse created = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "命中减少技能冷却",
                null,
                0,
                List.of(cooldownReduceResult(
                    "reduce_abilities",
                    List.of(SKILL_KEY, "ezreal_w", "ezreal_r")
                ))
            )
        );

        assertEquals(1, created.results().size());
        assertEquals(
            List.of(SKILL_KEY, "ezreal_w", "ezreal_r"),
            ((SkillEffectCooldownChangeDetail) created.results().get(0).detail()).affectedSkillScope().skillKeys()
        );
        assertEquals(created, service.get(GAME_ID, SKILL_KEY, EFFECT_KEY));
    }

    @Test
    void setRemainingRequiresValueRuleAndRejectsMissingRule() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        stubDetailRead(
            List.of(resultRow("set_self", SkillEffectResultType.COOLDOWN_CHANGE)),
            List.of(valueRow("set_self")),
            new DetailBundle(
                List.of(),
                List.of(),
                List.of(),
                List.of(new SkillEffectCooldownChangeDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "set_self", SkillEffectCooldownChangeOperation.SET_REMAINING
                )),
                List.of()
            )
        );
        SkillEffectDetailResponse created = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "设置剩余冷却",
                null,
                0,
                List.of(new SkillEffectResultRequest(
                    "set_self",
                    "设置剩余冷却",
                    SkillEffectResultType.COOLDOWN_CHANGE,
                    SkillEffectTarget.SOURCE,
                    null,
                    5,
                    valueRule(),
                    new SkillEffectCooldownChangeDetail(
                        skillsScope(List.of(SKILL_KEY)),
                        SkillEffectCooldownChangeOperation.SET_REMAINING
                    )
                ))
            )
        );
        assertEquals(SkillEffectCooldownChangeOperation.SET_REMAINING,
            ((SkillEffectCooldownChangeDetail) created.results().getFirst().detail()).operation());
        assertEquals(AggregateJson.tree(AggregateJson.write(valueRule())),
            AggregateJson.tree(AggregateJson.write(created.results().getFirst().valueRule())));

        ApiException missing = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "缺少数值",
                    null,
                    0,
                    List.of(new SkillEffectResultRequest(
                        "set_self",
                        "设置剩余冷却",
                        SkillEffectResultType.COOLDOWN_CHANGE,
                        SkillEffectTarget.SOURCE,
                        null,
                        5,
                        null,
                        new SkillEffectCooldownChangeDetail(
                            skillsScope(List.of(SKILL_KEY)),
                            SkillEffectCooldownChangeOperation.SET_REMAINING
                        )
                    ))
                )
            )
        );
        assertField(missing, "results[0].valueRule", "REQUIRED");
    }

    @Test
    void cooldownChangeRejectsEmptyAndDuplicateTargetLists() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);

        ApiException empty = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "空目标",
                    null,
                    0,
                    List.of(cooldownReduceResult("reduce_abilities", List.of()))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", empty.getCode());
        assertField(empty, "results[0].detail.affectedSkillScope.skillKeys", "AFFECTED_SKILL_REQUIRED");

        ApiException duplicate = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "重复目标",
                    null,
                    0,
                    List.of(cooldownReduceResult(
                        "reduce_abilities",
                        List.of("ezreal_w", " ezreal_w ")
                    ))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", duplicate.getCode());
        assertField(duplicate, "results[0].detail.affectedSkillScope.skillKeys[1]", "DUPLICATE_AFFECTED_SKILL");
    }

    @Test
    void cooldownAllScopePersistsEmptyRelations() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        stubDetailRead(
            List.of(resultRow("reduce_all", SkillEffectResultType.COOLDOWN_CHANGE)),
            List.of(valueRow("reduce_all")),
            new DetailBundle(
                List.of(),
                List.of(),
                List.of(),
                List.of(new SkillEffectCooldownChangeDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_all", SkillEffectCooldownChangeOperation.REDUCE
                )),
                List.of(),
                List.of(new SkillEffectSkillScopeRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_all", SkillEffectSkillScopeMode.ALL
                )),
                List.of(),
                List.of(),
                List.of()
            )
        );

        SkillEffectDetailResponse created = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "减少全部冷却",
                null,
                0,
                List.of(new SkillEffectResultRequest(
                    "reduce_all",
                    "减少冷却",
                    SkillEffectResultType.COOLDOWN_CHANGE,
                    SkillEffectTarget.SOURCE,
                    null,
                    0,
                    valueRule(),
                    new SkillEffectCooldownChangeDetail(allScope(), SkillEffectCooldownChangeOperation.REDUCE)
                ))
            )
        );

        SkillEffectAffectedSkillScope scope =
            ((SkillEffectCooldownChangeDetail) created.results().get(0).detail()).affectedSkillScope();
        assertEquals(SkillEffectSkillScopeMode.ALL, scope.mode());
        assertEquals(List.of(), scope.skillKeys());
        assertEquals(List.of(), scope.skillCategoryKeys());
    }

    @Test
    void hasteCategoriesScopeRequiresPersistentSnapshotAndRejectsMomentEvaluation() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        SkillEffectResultRequest haste = hasteIncreaseResult("haste_move", categoriesScope(List.of(CATEGORY_KEY)));
        ApiException missingLifecycle = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "技能急速", null, 0, List.of(haste))
            )
        );
        assertField(missingLifecycle, "results[0].lifecycleBehavior", "SPECIAL_RESULT_REQUIRES_PERSISTENT");

        SkillEffectResultRequest momentEval = new SkillEffectResultRequest(
            "haste_move",
            "增加技能急速",
            SkillEffectResultType.SKILL_HASTE_MODIFIER,
            SkillEffectTarget.SOURCE,
            null,
            0,
            valueRule(),
            new SkillEffectHasteModifierDetail(
                categoriesScope(List.of(CATEGORY_KEY)),
                SkillEffectModifierOperation.INCREASE
            ),
            new SkillEffectResultLifecycleBehaviorRequest(
                SkillEffectLifecycleMoment.PERSISTENT,
                SkillEffectLifecycleValueReadMode.MOMENT_EVALUATION,
                SkillEffectLifecycleStackValueMode.SHARED,
                SkillEffectLifecycleReapplicationValueMode.KEEP,
                null
            )
        );
        ApiException moment = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "技能急速", null, 0, timedLifecycle(), List.of(momentEval)
                )
            )
        );
        assertField(moment, "results[0].lifecycleBehavior.valueReadMode", "COMBINATION_INVALID");

        stubDetailRead(
            List.of(resultRow("haste_move", SkillEffectResultType.SKILL_HASTE_MODIFIER)),
            List.of(valueRow("haste_move")),
            new DetailBundle(
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                List.of(new SkillEffectSkillScopeRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "haste_move", SkillEffectSkillScopeMode.CATEGORIES
                )),
                List.of(),
                List.of(new SkillEffectSkillCategoryTargetRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "haste_move", CATEGORY_KEY
                )),
                List.of(new SkillEffectHasteModifierDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "haste_move", SkillEffectModifierOperation.INCREASE
                ))
            )
        );
        fixture.put("findLifecycle", lifecycleRow());
        fixture.put("listLifecycleBehaviors", List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "haste_move",
                SkillEffectLifecycleMoment.PERSISTENT,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                SkillEffectLifecycleStackValueMode.SHARED,
                SkillEffectLifecycleReapplicationValueMode.KEEP,
                null
            )
        ));

        SkillEffectDetailResponse created = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY, "技能急速", null, 0, timedLifecycle(), List.of(
                    hasteIncreaseResult("haste_move", categoriesScope(List.of(CATEGORY_KEY)))
                )
            )
        );
        SkillEffectHasteModifierDetail detail =
            (SkillEffectHasteModifierDetail) created.results().get(0).detail();
        assertEquals(SkillEffectSkillScopeMode.CATEGORIES, detail.affectedSkillScope().mode());
        assertEquals(List.of(), detail.affectedSkillScope().skillKeys());
        assertEquals(List.of(CATEGORY_KEY), detail.affectedSkillScope().skillCategoryKeys());
        verify(mapper).lockSkillCategories(eq(GAME_ID), anyCollection());
    }

    @Test
    void cooldownChangeRejectsRemovedScalarFieldAsInvalidBody() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        SkillEffectResultRequest result = new SkillEffectResultRequest(
            "reduce_abilities",
            "旧单值字段",
            SkillEffectResultType.COOLDOWN_CHANGE,
            SkillEffectTarget.SOURCE,
            null,
            0,
            valueRule(),
            new SkillEffectCooldownChangeDetail(
                null,
                SkillEffectCooldownChangeOperation.REDUCE,
                Set.of(),
                Set.of("affectedSkillKey")
            )
        );

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "旧字段", null, 0, List.of(result))
            )
        );

        assertEquals("400.INVALID_BODY", exception.getCode());
        assertField(exception, "results[0].detail.affectedSkillKey", "UNKNOWN_FIELD");
    }

    @Test
    void updateRetainsDisabledCooldownTargetsButRejectsNewDisabledTargets() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("reduce_abilities", SkillEffectResultType.COOLDOWN_CHANGE)
        ));
        fixture.put("listValues", List.of(valueRow("reduce_abilities")));
        fixture.put("listDamageDetails", List.of());
        fixture.put("listAttributeChangeDetails", List.of());
        fixture.put("listResourceChangeDetails", List.of());
        fixture.put("listCooldownChangeDetails", List.of(
            new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", SkillEffectCooldownChangeOperation.REDUCE
            )
        ));
        fixture.put("listSkillScopes", List.of(
            new SkillEffectSkillScopeRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", SkillEffectSkillScopeMode.SKILLS
            )
        ));
        fixture.put("listSkillTargets", List.of(
            new SkillEffectSkillTargetRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", "disabled_existing"
            )
        ));
        fixture.put("listStatusOperationDetails", List.of());
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of(FORMULA_KEY));
        when(mapper.lockSkills(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectCatalogLockRow("disabled_existing", "DISABLED"),
            new SkillEffectCatalogLockRow("disabled_new", "DISABLED")
        ));

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null,
                    "停用目标集合",
                    null,
                    0,
                    List.of(cooldownReduceResult(
                        "reduce_abilities",
                        List.of("disabled_existing", "disabled_new")
                    ))
                )
            )
        );

        assertEquals("409.SKILL_EFFECT_REFERENCE_DISABLED", exception.getCode());
        assertField(exception, "results[0].detail.affectedSkillScope.skillKeys[1]", "SKILL_DISABLED");
    }

    @Test
    void deleteEffectDoesNotTouchCatalogs() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        when(mapper.deleteEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1);

        service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY);

        verify(mapper).deleteEffect(GAME_ID, SKILL_KEY, EFFECT_KEY);
        verify(skillMapper, never()).delete(any(), any());
    }

    @Test
    void deleteEffectProtectsProcessBindingsWithStableConflict() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);

        assertCode("409.SKILL_EFFECT_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
        verify(mapper, never()).deleteEffect(any(), any(), any());
        org.mockito.Mockito.verifyNoInteractions(imageRelationMapper);

        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.deleteEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenThrow(
            new DataIntegrityViolationException(
                "violates foreign key constraint fk_skill_process_effect_bindings_effect"
            )
        );
        assertCode("409.SKILL_EFFECT_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
    }

    @Test
    void createsWithoutLifecycleLeavesBehaviorNullAndDoesNotInsertLifecycle() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        stubDetailRead(sixNonShieldResultRows(), sixNonShieldValueRows(), sixNonShieldDetails());

        SkillEffectDetailResponse detail = service.create(GAME_ID, SKILL_KEY, createSixNonShieldResults());
        assertNull(detail.lifecycle());
        assertNull(detail.results().get(0).lifecycleBehavior());
    }

    @Test
    void createsFullLifecycleAndReadsItBackWithApplicationBehavior() {
        stubParentAndNewKey();
        stubEnabledCatalogs();

        stubDetailRead(List.of(resultRow("physical_hit", SkillEffectResultType.DAMAGE)),
            List.of(valueRow("physical_hit")),
            new DetailBundle(
                List.of(new SkillEffectDamageDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
                )),
                List.of(), List.of(), List.of(), List.of()
            ));
        fixture.put("findLifecycle", lifecycleRow());
        fixture.put("listLifecycleBehaviors", List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                null, null, null
            )
        ));

        SkillEffectDetailResponse detail = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))
            )
        );
        assertEquals(SkillEffectLifecycleInstanceScope.TARGET, detail.lifecycle().instanceScope());
        assertEquals(SkillNumericValue.formula(DURATION_FORMULA), detail.lifecycle().durationValue());
        assertEquals(SkillEffectLifecycleMoment.APPLICATION, detail.results().get(0).lifecycleBehavior().moment());
    }

    @Test
    void rejectsPeriodicMismatchBothDirectionsAndNaturalEndWithoutDuration() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());

        ApiException missingPeriodic = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                    List.of(damageResultWithBehavior(
                        "physical_hit",
                        new SkillEffectResultLifecycleBehaviorRequest(
                            SkillEffectLifecycleMoment.PERIODIC,
                            SkillEffectLifecycleValueReadMode.MOMENT_EVALUATION,
                            null, null, SkillEffectLifecyclePeriodicExecutionMode.ONCE_PER_INSTANCE
                        )
                    ))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", missingPeriodic.getCode());
        assertField(missingPeriodic, "lifecycle.periodicIntervalValue", "REQUIRED");

        ApiException extraPeriodic = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10,
                    new SkillEffectLifecycleRequest(
                        SkillNumericValue.formula(DURATION_FORMULA), SkillNumericValue.formula(MAX_STACKS_FORMULA), SkillNumericValue.formula(APP_STACKS_FORMULA),
                        SkillEffectLifecycleInstanceScope.TARGET,
                        SkillEffectLifecycleReapplicationStackMode.INCREASE,
                        SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL,
                        SkillEffectLifecycleExpiryMode.ALL_AT_ONCE,
                        SkillNumericValue.formula(PERIODIC_FORMULA),
                        SkillEffectLifecycleFirstPeriodicExecution.IMMEDIATE
                    ),
                    List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", extraPeriodic.getCode());
        assertField(extraPeriodic, "lifecycle.periodicIntervalValue", "FORBIDDEN");

        ApiException naturalEnd = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10,
                    new SkillEffectLifecycleRequest(
                        null, SkillNumericValue.formula(MAX_STACKS_FORMULA), SkillNumericValue.formula(APP_STACKS_FORMULA),
                        SkillEffectLifecycleInstanceScope.TARGET,
                        SkillEffectLifecycleReapplicationStackMode.KEEP,
                        null,
                        SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY,
                        null, null
                    ),
                    List.of(statusResultWithBehavior(
                        "apply_poison",
                        new SkillEffectResultLifecycleBehaviorRequest(
                            SkillEffectLifecycleMoment.NATURAL_END, null, null, null, null
                        )
                    ))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", naturalEnd.getCode());
        assertField(naturalEnd, "results[0].lifecycleBehavior.moment", "COMBINATION_INVALID");
    }

    @Test
    void acceptsPersistentShieldAttributeAndStatusApplyAndRejectsDamagePersistent() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());

        ApiException damagePersistent = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                    List.of(damageResultWithBehavior(
                        "physical_hit",
                        new SkillEffectResultLifecycleBehaviorRequest(
                            SkillEffectLifecycleMoment.PERSISTENT,
                            SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                            SkillEffectLifecycleStackValueMode.SHARED,
                            SkillEffectLifecycleReapplicationValueMode.KEEP,
                            null
                        )
                    ))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", damagePersistent.getCode());
        assertField(damagePersistent, "results[0].lifecycleBehavior.moment", "COMBINATION_INVALID");

        SkillEffectLifecycleRequest lifecycleWithoutDuration = new SkillEffectLifecycleRequest(
            null,
            SkillNumericValue.formula(MAX_STACKS_FORMULA),
            SkillNumericValue.formula(APP_STACKS_FORMULA),
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.INCREASE,
            SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL,
            SkillEffectLifecycleExpiryMode.ALL_AT_ONCE,
            null,
            null
        );
        ApiException linearWithoutDuration = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY,
                    "命中结果",
                    null,
                    10,
                    lifecycleWithoutDuration,
                    List.of(shieldResultWithBehavior(
                        "normal_shield",
                        new SkillEffectNormalShieldDetail("physical", SkillEffectNormalShieldDecayMode.LINEAR_TO_ZERO),
                        persistentShared()
                    ))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", linearWithoutDuration.getCode());
        assertField(linearWithoutDuration, "lifecycle.durationValue", "REQUIRED");

        stubParentAndNewKey();
        stubEnabledCatalogs();

        stubDetailRead(
            List.of(resultRow("normal_shield", SkillEffectResultType.NORMAL_SHIELD)),
            List.of(valueRow("normal_shield")),
            new DetailBundle(List.of(), List.of(), List.of(), List.of(), List.of())
        );
        fixture.put("listNormalShieldInteractions", List.of(
            new SkillEffectNormalShieldInteractionRow(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                "normal_shield",
                "physical",
                SkillEffectNormalShieldDecayMode.LINEAR_TO_ZERO
            )
        ));
        fixture.put("findLifecycle", lifecycleRow());
        fixture.put("listLifecycleBehaviors", List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "normal_shield",
                SkillEffectLifecycleMoment.PERSISTENT,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                SkillEffectLifecycleStackValueMode.SHARED,
                SkillEffectLifecycleReapplicationValueMode.KEEP,
                null
            )
        ));

        SkillEffectDetailResponse detail = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                List.of(shieldResultWithBehavior(
                    "normal_shield",
                    new SkillEffectNormalShieldDetail("physical", SkillEffectNormalShieldDecayMode.LINEAR_TO_ZERO),
                    persistentShared()
                ))
            )
        );
        assertEquals(SkillEffectLifecycleMoment.PERSISTENT, detail.results().get(0).lifecycleBehavior().moment());
        assertEquals(
            SkillEffectLifecycleStackValueMode.SHARED,
            detail.results().get(0).lifecycleBehavior().stackValueMode()
        );
        SkillEffectNormalShieldDetail shield = (SkillEffectNormalShieldDetail) detail.results().get(0).detail();
        assertEquals("physical", shield.absorbedDamageTypeKey());
        assertEquals(SkillEffectNormalShieldDecayMode.LINEAR_TO_ZERO, shield.decayMode());
    }

    @Test
    void rejectsLegacyVampFieldEvenWhenNullBeforeWriting() {
        stubParentAndNewKey();
        for (String legacy : List.of("null", "[]")) {
            ObjectNode encoded = (ObjectNode) AggregateJson.tree(AggregateJson.write(damageResult("physical_hit")));
            ((ObjectNode) encoded.path("detail")).set("vampRules", AggregateJson.tree(legacy));
            SkillEffectResultRequest result = AggregateJson.read(encoded.toString(), SkillEffectResultRequest.class);
            ApiException error = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "伤害", null, 10, List.of(result))));
            assertField(error, "results[0].detail.vampRules", "UNKNOWN_FIELD");
        }
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void createsAndReadsBackPersistentStatusApplyResultScope() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        stubDetailRead(
            List.of(resultRow("apply_poison", SkillEffectResultType.STATUS_OPERATION)),
            List.of(),
            new DetailBundle(
                List.of(), List.of(), List.of(), List.of(),
                List.of(new SkillEffectStatusOperationDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "apply_poison", "poison", SkillEffectStatusOperation.APPLY
                ))
            )
        );

        SkillEffectDetailResponse created = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "持续眩晕",
                null,
                10,
                timedLifecycle(),
                List.of(statusResultWithScope(
                    SkillEffectTarget.TARGET,
                    SkillEffectStatusOperation.APPLY,
                    persistentStatusBehavior(),
                    SkillEffectSpellShieldBlockScope.RESULT
                ))
            )
        );

        assertEquals(SkillEffectLifecycleMoment.PERSISTENT, created.results().get(0).lifecycleBehavior().moment());
        assertEquals(SkillEffectSpellShieldBlockScope.RESULT, created.results().get(0).spellShieldBlockScope());
        ObjectNode stored = (ObjectNode) AggregateJson.tree(savedEffect.results()).get(0);
        assertEquals("RESULT", stored.path("spellShieldBlockScope").asText());

        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        SkillEffectDetailResponse readBack = service.get(GAME_ID, SKILL_KEY, EFFECT_KEY);
        assertEquals(created, readBack);
        assertEquals(SkillEffectSpellShieldBlockScope.RESULT, readBack.results().get(0).spellShieldBlockScope());
    }

    @Test
    void keepsNullScopeAndRejectsOtherPersistentScopeShapes() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        stubDetailRead(
            List.of(resultRow("apply_poison", SkillEffectResultType.STATUS_OPERATION)),
            List.of(),
            new DetailBundle(
                List.of(), List.of(), List.of(), List.of(),
                List.of(new SkillEffectStatusOperationDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "apply_poison", "poison", SkillEffectStatusOperation.APPLY
                ))
            )
        );

        SkillEffectDetailResponse withoutScope = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "持续眩晕",
                null,
                10,
                timedLifecycle(),
                List.of(statusResultWithScope(
                    SkillEffectTarget.TARGET,
                    SkillEffectStatusOperation.APPLY,
                    persistentStatusBehavior(),
                    null
                ))
            )
        );
        assertNull(withoutScope.results().get(0).spellShieldBlockScope());

        List<SkillEffectResultRequest> invalid = List.of(
            statusResultWithScope(
                SkillEffectTarget.TARGET,
                SkillEffectStatusOperation.APPLY,
                persistentStatusBehavior(),
                SkillEffectSpellShieldBlockScope.SKILL
            ),
            statusResultWithScope(
                SkillEffectTarget.TARGET,
                SkillEffectStatusOperation.APPLY,
                persistentStatusBehavior(),
                SkillEffectSpellShieldBlockScope.EFFECT
            ),
            statusResultWithScope(
                SkillEffectTarget.TARGET,
                SkillEffectStatusOperation.APPLY,
                persistentStatusBehavior(),
                SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE
            ),
            statusResultWithScope(
                SkillEffectTarget.SOURCE,
                SkillEffectStatusOperation.APPLY,
                persistentStatusBehavior(),
                SkillEffectSpellShieldBlockScope.RESULT
            ),
            statusResultWithScope(
                SkillEffectTarget.TARGET,
                SkillEffectStatusOperation.REMOVE,
                persistentStatusBehavior(),
                SkillEffectSpellShieldBlockScope.RESULT
            ),
            persistentDamageModifierWithScope(SkillEffectSpellShieldBlockScope.RESULT)
        );

        for (SkillEffectResultRequest result : invalid) {
            stubParentAndNewKey();
            ApiException exception = assertThrows(
                ApiException.class,
                () -> service.create(
                    GAME_ID,
                    SKILL_KEY,
                    new SkillEffectCreateRequest(EFFECT_KEY, "非法持续阻挡粒度", null, 10, timedLifecycle(), List.of(result))
                )
            );
            assertEquals("400.VALIDATION_FAILED", exception.getCode());
            assertField(exception, "results[0].spellShieldBlockScope", "INVALID_SPELL_SHIELD_SCOPE");
        }
    }

    @Test
    void lifecycleOperationsRequireValueExceptRefreshRemoveAndProtectTargetReferences() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        stubEnabledCatalogs();

        ApiException missingValue = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                    List.of(lifecycleOpResult(
                        "inc_mark", SkillEffectLifecycleOperation.INCREASE, TARGET_EFFECT_KEY, null,
                        applicationSnapshot()
                    ))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", missingValue.getCode());
        assertField(missingValue, "results[0].valueRule", "REQUIRED");

        ApiException refreshValue = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                    List.of(lifecycleOpResult(
                        "refresh_mark", SkillEffectLifecycleOperation.REFRESH, TARGET_EFFECT_KEY, valueRule(),
                        new SkillEffectResultLifecycleBehaviorRequest(
                            SkillEffectLifecycleMoment.APPLICATION, null, null, null, null
                        )
                    ))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", refreshValue.getCode());
        assertField(refreshValue, "results[0].valueRule", "FORBIDDEN");

        ApiException selfRef = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                    List.of(lifecycleOpResult(
                        "refresh_self", SkillEffectLifecycleOperation.REMOVE, EFFECT_KEY, null,
                        new SkillEffectResultLifecycleBehaviorRequest(
                            SkillEffectLifecycleMoment.APPLICATION, null, null, null, null
                        )
                    ))
                )
            )
        );
        assertEquals("400.INVALID_SKILL_EFFECT_REFERENCE", selfRef.getCode());
        assertField(selfRef, "results[0].detail.targetEffectKey", "SELF_LIFECYCLE_REFERENCE");
    }

    @Test
    void refreshWithoutDurationIsRejectedBeforeWrite() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.lockEffects(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(TARGET_EFFECT_KEY));
        when(mapper.lockLifecycles(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(lifecycleRowWithoutDuration(TARGET_EFFECT_KEY)));

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                    List.of(lifecycleOpResult(
                        "refresh_mark", SkillEffectLifecycleOperation.REFRESH, TARGET_EFFECT_KEY, null,
                        new SkillEffectResultLifecycleBehaviorRequest(
                            SkillEffectLifecycleMoment.APPLICATION, null, null, null, null
                        )
                    ))
                )
            )
        );
        assertEquals("400.INVALID_SKILL_EFFECT_REFERENCE", exception.getCode());
        assertField(exception, "results[0].detail.targetEffectKey", "TARGET_EFFECT_HAS_NO_DURATION");
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void extendDurationRequiresTimedAllAtOnceTargetAndReadsBack() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.lockEffects(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(TARGET_EFFECT_KEY));
        when(mapper.lockLifecycles(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(lifecycleRowFor(TARGET_EFFECT_KEY, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE)));
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);

        SkillEffectDetailResponse created = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillEffectCreateRequest(
                EFFECT_KEY,
                "延长剩余时长",
                null,
                10,
                timedLifecycle(),
                List.of(lifecycleOpResult(
                    "extend_mark",
                    SkillEffectLifecycleOperation.EXTEND_DURATION,
                    TARGET_EFFECT_KEY,
                    valueRule(),
                    applicationSnapshot()
                ))
            )
        );

        assertEquals(SkillEffectLifecycleOperation.EXTEND_DURATION,
            ((SkillEffectLifecycleOperationDetail) created.results().getFirst().detail()).operation());
        assertEquals(TARGET_EFFECT_KEY,
            ((SkillEffectLifecycleOperationDetail) created.results().getFirst().detail()).targetEffectKey());

        when(mapper.lockLifecycles(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(lifecycleRowWithoutDuration(TARGET_EFFECT_KEY)));
        ApiException noDuration = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    "extend_no_duration",
                    "延长剩余时长",
                    null,
                    10,
                    timedLifecycle(),
                    List.of(lifecycleOpResult(
                        "extend_mark",
                        SkillEffectLifecycleOperation.EXTEND_DURATION,
                        TARGET_EFFECT_KEY,
                        valueRule(),
                        applicationSnapshot()
                    ))
                )
            )
        );
        assertEquals("400.INVALID_SKILL_EFFECT_REFERENCE", noDuration.getCode());
        assertField(noDuration, "results[0].detail.targetEffectKey", "TARGET_EFFECT_HAS_NO_DURATION");

        when(mapper.lockLifecycles(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(lifecycleRowFor(TARGET_EFFECT_KEY, SkillEffectLifecycleExpiryMode.ONE_BY_ONE)));
        ApiException wrongExpiry = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    "extend_wrong_expiry",
                    "延长剩余时长",
                    null,
                    10,
                    timedLifecycle(),
                    List.of(lifecycleOpResult(
                        "extend_mark",
                        SkillEffectLifecycleOperation.EXTEND_DURATION,
                        TARGET_EFFECT_KEY,
                        valueRule(),
                        applicationSnapshot()
                    ))
                )
            )
        );
        assertEquals("400.INVALID_SKILL_EFFECT_REFERENCE", wrongExpiry.getCode());
        assertField(
            wrongExpiry,
            "results[0].detail.targetEffectKey",
            "TARGET_EFFECT_EXPIRY_MODE_UNSUPPORTED"
        );
    }

    @Test
    void deletePrefersProcessBindingOverLifecycleReference() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(2L);
        when(mapper.countLifecycleOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(3L);

        assertCode("409.SKILL_EFFECT_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
        verify(mapper, never()).deleteEffect(any(), any(), any());
    }

    @Test
    void deleteLifecycleInUseWhenOnlyOperationReferencesExist() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.countLifecycleOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);

        assertCode("409.SKILL_EFFECT_LIFECYCLE_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
        verify(mapper, never()).deleteEffect(any(), any(), any());
        org.mockito.Mockito.verifyNoInteractions(imageRelationMapper);
    }

    @Test
    void removingLifecycleIsRejectedWhenReferencedAndClearingDurationIsRejectedWhenRefreshInUse() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("findLifecycleForUpdate", lifecycleRow());
        when(mapper.countLifecycleOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);
        stubEnabledCatalogs();

        assertCode(
            "409.SKILL_EFFECT_LIFECYCLE_IN_USE",
            () -> service.update(
                GAME_ID, SKILL_KEY, EFFECT_KEY,
                new SkillEffectUpdateRequest(null, "命中结果", null, 10, List.of(damageResult("physical_hit")))
            )
        );

        when(mapper.countLifecycleOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.countRefreshOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);
        ApiException refresh = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID, SKILL_KEY, EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null, "命中结果", null, 10,
                    new SkillEffectLifecycleRequest(
                        null, SkillNumericValue.formula(MAX_STACKS_FORMULA), SkillNumericValue.formula(APP_STACKS_FORMULA),
                        SkillEffectLifecycleInstanceScope.TARGET,
                        SkillEffectLifecycleReapplicationStackMode.KEEP,
                        null,
                        SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY,
                        null, null
                    ),
                    List.of(damageResultWithBehavior(
                        "physical_hit",
                        new SkillEffectResultLifecycleBehaviorRequest(
                            SkillEffectLifecycleMoment.APPLICATION,
                            SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                            null, null, null
                        )
                    ))
                )
            )
        );
        assertEquals("409.SKILL_EFFECT_LIFECYCLE_IN_USE", refresh.getCode());
        assertField(refresh, "lifecycle.durationValue", "REFRESH_OPERATION_IN_USE");
    }

    @Test
    void extendDurationProtectsTargetDurationAndExpiryOnReverseUpdate() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("findLifecycleForUpdate", lifecycleRow());
        when(mapper.countLifecycleOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.countRefreshOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.countExtendDurationOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);

        ApiException duration = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null,
                    "命中结果",
                    null,
                    10,
                    new SkillEffectLifecycleRequest(
                        null,
                        SkillNumericValue.formula(MAX_STACKS_FORMULA),
                        SkillNumericValue.formula(APP_STACKS_FORMULA),
                        SkillEffectLifecycleInstanceScope.TARGET,
                        SkillEffectLifecycleReapplicationStackMode.KEEP,
                        null,
                        SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY,
                        null,
                        null
                    ),
                    List.of(damageResult("physical_hit"))
                )
            )
        );
        assertEquals("409.SKILL_EFFECT_LIFECYCLE_IN_USE", duration.getCode());
        assertField(duration, "lifecycle.durationValue", "EXTEND_DURATION_OPERATION_IN_USE");

        ApiException expiry = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null,
                    "命中结果",
                    null,
                    10,
                    new SkillEffectLifecycleRequest(
                        SkillNumericValue.formula(DURATION_FORMULA),
                        SkillNumericValue.formula(MAX_STACKS_FORMULA),
                        SkillNumericValue.formula(APP_STACKS_FORMULA),
                        SkillEffectLifecycleInstanceScope.TARGET,
                        SkillEffectLifecycleReapplicationStackMode.KEEP,
                        SkillEffectLifecycleReapplicationDurationMode.KEEP_REMAINING,
                        SkillEffectLifecycleExpiryMode.ONE_BY_ONE,
                        null,
                        null
                    ),
                    List.of(damageResult("physical_hit"))
                )
            )
        );
        assertEquals("409.SKILL_EFFECT_LIFECYCLE_IN_USE", expiry.getCode());
        assertField(expiry, "lifecycle.expiryMode", "EXTEND_DURATION_OPERATION_IN_USE");
    }

    @Test
    void updateExistingLifecycleUsesInPlaceUpdate() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("findLifecycleForUpdate", lifecycleRow());
        fixture.put("listValues", List.of(valueRow("physical_hit")));
        fixture.put("listDamageDetails", List.of(
            new SkillEffectDamageDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical")
        ));
        fixture.put("listLifecycleBehaviors", List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                null, null, null
            )
        ));
        stubEnabledCatalogs();

        stubDetailRead(
            List.of(resultRow("physical_hit", SkillEffectResultType.DAMAGE)),
            List.of(valueRow("physical_hit")),
            new DetailBundle(
                List.of(new SkillEffectDamageDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
                )),
                List.of(), List.of(), List.of(), List.of()
            )
        );
        fixture.put("findLifecycle", lifecycleRow());

        service.update(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            new SkillEffectUpdateRequest(
                null, "命中结果", null, 10, timedLifecycle(),
                List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))
            )
        );
    }

    @Test
    void unknownLifecycleFormulaIsCollectedWithResultFormulas() {
        stubParentAndNewKey();
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        when(mapper.lockDamageTypes(eq(GAME_ID), anyCollection())).thenReturn(List.of(
            new SkillEffectCatalogLockRow("physical", "ENABLED")
        ));

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10, timedLifecycle(),
                    List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))
                )
            )
        );
        assertEquals("400.INVALID_SKILL_EFFECT_REFERENCE", exception.getCode());
        assertField(exception, "lifecycle.durationValue", "UNKNOWN_LIFECYCLE_FORMULA");
        assertField(exception, "lifecycle.maxStacksValue", "UNKNOWN_LIFECYCLE_FORMULA");
        assertField(exception, "results[0].valueRule.value", "UNKNOWN_FORMULA");
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void instanceScopeIsImmutableOnExistingLifecycle() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("findLifecycleForUpdate", lifecycleRow());

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null, "命中结果", null, 10,
                    new SkillEffectLifecycleRequest(
                        SkillNumericValue.formula(DURATION_FORMULA), SkillNumericValue.formula(MAX_STACKS_FORMULA), SkillNumericValue.formula(APP_STACKS_FORMULA),
                        SkillEffectLifecycleInstanceScope.SKILL,
                        SkillEffectLifecycleReapplicationStackMode.INCREASE,
                        SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL,
                        SkillEffectLifecycleExpiryMode.ALL_AT_ONCE,
                        null, null
                    ),
                    List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", exception.getCode());
        assertField(exception, "lifecycle.instanceScope", "IMMUTABLE");
    }

    @Test
    void listsLifecycleEnabledFromSummaryAggregation() {
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.listSummaries(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillEffectSummaryResponse(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "命中结果", null, 10, 1, true, TS, TS
            )
        ));
        assertEquals(true, service.list(GAME_ID, SKILL_KEY).get(0).lifecycleEnabled());
    }

    @Test
    void unknownWriteConstraintIsNotMapped() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        DataIntegrityViolationException unrelated = new DataIntegrityViolationException(
            "violates foreign key constraint fk_unrelated_table"
        );
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any(), any(), any())).thenThrow(unrelated);
        DataIntegrityViolationException thrown = assertThrows(
            DataIntegrityViolationException.class,
            () -> service.create(GAME_ID, SKILL_KEY, createDamageOnly())
        );
        assertEquals(unrelated, thrown);
    }

    @Test
    void assembleReturnsInternalErrorWhenShapeIsCorrupt() {
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> readEffect());
        fixture.put("listResults", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("listValues", List.of());
        fixture.put("listDamageDetails", List.of());
        fixture.put("listAttributeChangeDetails", List.of());
        fixture.put("listResourceChangeDetails", List.of());
        fixture.put("listCooldownChangeDetails", List.of());
        fixture.put("listStatusOperationDetails", List.of());

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.get(GAME_ID, SKILL_KEY, EFFECT_KEY)
        );
        assertEquals("500.INTERNAL_ERROR", exception.getCode());
        assertEquals(GAME_ID, exception.getDetails().get("gameId"));
        assertEquals(SKILL_KEY, exception.getDetails().get("skillKey"));
        assertEquals(EFFECT_KEY, exception.getDetails().get("effectKey"));
        assertEquals("physical_hit", exception.getDetails().get("resultKey"));
    }

    @Test
    void duplicateEffectKeyMapsToStableConflict() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any(), any(), any()))
            .thenThrow(new DataIntegrityViolationException("violates pk_skill_effects"));

        assertCode("409.SKILL_EFFECT_KEY_EXISTS", () -> service.create(GAME_ID, SKILL_KEY, createDamageOnly()));
    }

    @Test
    void triggerRuleProtectsEffectDeleteUpdateAndCycleWithLongConstructor() {
        xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService triggerRuleService =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService.class);
        SkillEffectService guarded = new SkillEffectService(gamesMapper, skillMapper, mapper, triggerRuleService, imageRelationMapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(triggerRuleService.effectDeleteIssues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            Map.of("field", "effectKey", "code", "TRIGGER_RULE_EFFECT_IN_USE", "message", "技能效果仍被触发规则引用，不能删除")
        ));
        ApiException triggerOnly = assertThrows(ApiException.class, () -> guarded.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
        assertEquals("409.SKILL_EFFECT_IN_USE", triggerOnly.getCode());
        assertField(triggerOnly, "effectKey", "TRIGGER_RULE_EFFECT_IN_USE");
        verify(mapper, never()).deleteEffect(any(), any(), any());

        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);
        ApiException preferred = assertThrows(ApiException.class, () -> guarded.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
        assertEquals("409.SKILL_EFFECT_IN_USE", preferred.getCode());
        assertField(preferred, "effectKey", "CONFLICT");

        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_EFFECT_IN_USE",
            "结果仍被触发规则引用，不能移除",
            Map.of("fieldIssues", List.of(Map.of("field", "results", "code", "TRIGGER_RULE_RESULT_IN_USE")))
        )).when(triggerRuleService).assertEffectUpdate(any(), any(), any(), any(), any(), any(), any());
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("findLifecycleForUpdate", lifecycleRow());
        stubEnabledCatalogs();
        ApiException result = assertThrows(
            ApiException.class,
            () -> guarded.update(
                GAME_ID, SKILL_KEY, EFFECT_KEY,
                new SkillEffectUpdateRequest(null, "命中结果", null, 10, List.of(damageResult("physical_hit")))
            )
        );
        assertEquals("409.SKILL_EFFECT_IN_USE", result.getCode());
        assertField(result, "results", "TRIGGER_RULE_RESULT_IN_USE");

        org.mockito.Mockito.reset(triggerRuleService);
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.BAD_REQUEST,
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            "触发规则存在未受保护的循环",
            Map.of()
        )).when(triggerRuleService).assertCurrentSkillCycle(GAME_ID, SKILL_KEY);
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("findLifecycleForUpdate", lifecycleRow());
        fixture.put("listValues", List.of(valueRow("physical_hit")));
        fixture.put("listDamageDetails", List.of(
            new SkillEffectDamageDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical")
        ));
        fixture.put("listLifecycleBehaviors", List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                null, null, null
            )
        ));
        stubEnabledCatalogs();

        assertCode(
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            () -> guarded.update(
                GAME_ID, SKILL_KEY, EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null, "命中结果", null, 10, timedLifecycle(),
                    List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))
                )
            )
        );
    }

    @Test
    void stage765InboundShapeConflictDoesNotWriteAndUnreferencedUpdateSucceeds() {
        xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService triggerRuleService =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService.class);
        SkillEffectService guarded = new SkillEffectService(gamesMapper, skillMapper, mapper, triggerRuleService, imageRelationMapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> fixtureRow(true));
        fixture.put("listResultsForUpdate", List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        fixture.put("findLifecycleForUpdate", null);
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_EFFECT_IN_USE",
            "结果形状变化会使既有前序输出失效",
            Map.of("fieldIssues", List.of(Map.of(
                "field", "results[0].detail.vampOverrides",
                "code", "TRIGGER_RULE_SHAPE_IN_USE",
                "ruleKey", "prior",
                "actionKey", "follow",
                "bindingKey", "from_first",
                "outputKind", "ACTUAL_HEALING"
            )))
        )).when(triggerRuleService).assertEffectUpdate(any(), any(), any(), any(), any(), any(), any());
        ApiException blocked = assertThrows(
            ApiException.class,
            () -> guarded.update(
                GAME_ID, SKILL_KEY, EFFECT_KEY,
                new SkillEffectUpdateRequest(null, "命中结果", null, 10, List.of(damageResult("physical_hit")))
            )
        );
        assertEquals("409.SKILL_EFFECT_IN_USE", blocked.getCode());
        assertField(blocked, "results[0].detail.vampOverrides", "TRIGGER_RULE_SHAPE_IN_USE");
        assertEquals("ACTUAL_HEALING", fieldIssues(blocked).get(0).get("outputKind"));
        verify(mapper, never()).updateEffect(any(), any(), any(), any(), any(), any(), any(), any());

        org.mockito.Mockito.reset(triggerRuleService);
        stubEnabledCatalogs();
        fixture.put("listValues", List.of(valueRow("physical_hit")));
        fixture.put("listDamageDetails", List.of(
            new SkillEffectDamageDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical")
        ));
        fixture.put("listAttributeChangeDetails", List.of());
        fixture.put("listResourceChangeDetails", List.of());
        fixture.put("listCooldownChangeDetails", List.of());
        fixture.put("listStatusOperationDetails", List.of());
        fixture.put("listLifecycleBehaviors", List.of());

        stubDetailRead(
            List.of(resultRow("physical_hit", SkillEffectResultType.DAMAGE)),
            List.of(valueRow("physical_hit")),
            new DetailBundle(
                List.of(new SkillEffectDamageDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
                )),
                List.of(), List.of(), List.of(), List.of()
            )
        );
        guarded.update(
            GAME_ID, SKILL_KEY, EFFECT_KEY,
            new SkillEffectUpdateRequest(null, "命中结果", null, 10, List.of(damageResult("physical_hit")))
        );
        verify(mapper).updateEffect(eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("命中结果"), eq(null), eq(10), any(), any());
    }

    @Test
    void lifecycleOnlyEffectCreatesReadsAndUpdatesWithoutInventingResults() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);

        SkillEffectDetailResponse created = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
            EFFECT_KEY, "资格窗口", null, 10, timedLifecycle(), List.of()
        ));
        assertEquals("[]", savedEffect.results());
        assertTrue(created.results().isEmpty());
        assertEquals(DURATION_FORMULA, created.lifecycle().durationValue().formulaKey());
        assertEquals(created, service.get(GAME_ID, SKILL_KEY, EFFECT_KEY));

        SkillEffectDetailResponse updated = service.update(GAME_ID, SKILL_KEY, EFFECT_KEY,
            new SkillEffectUpdateRequest(null, "更新资格窗口", null, 20, timedLifecycle(), List.of()));
        assertTrue(updated.results().isEmpty());
        assertEquals(created.lifecycle(), updated.lifecycle());
        assertEquals("更新资格窗口", updated.name());
        assertEquals(updated, service.get(GAME_ID, SKILL_KEY, EFFECT_KEY));
        verify(mapper, org.mockito.Mockito.atLeastOnce()).lockFormulas(eq(GAME_ID), eq(SKILL_KEY),
            org.mockito.ArgumentMatchers.argThat(keys -> keys.size() == 3
                && keys.containsAll(Set.of(DURATION_FORMULA, MAX_STACKS_FORMULA, APP_STACKS_FORMULA))));
    }

    @Test
    void lifecycleOnlyEffectMayHaveNoNaturalDuration() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        SkillEffectLifecycleRequest lifecycle = new SkillEffectLifecycleRequest(
            null, SkillNumericValue.formula(MAX_STACKS_FORMULA), SkillNumericValue.formula(APP_STACKS_FORMULA),
            SkillEffectLifecycleInstanceScope.SOURCE_TARGET, SkillEffectLifecycleReapplicationStackMode.KEEP,
            null, SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY, null, null);
        SkillEffectDetailResponse created = service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
            EFFECT_KEY, "持续资格", null, 10, lifecycle, List.of()));
        assertNull(created.lifecycle().durationValue());
        assertEquals(SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY, created.lifecycle().expiryMode());
        assertTrue(created.results().isEmpty());
    }

    @Test
    void nullResultsAreRejectedByBothServiceEntrypointsEvenWithLifecycle() {
        for (SkillEffectLifecycleRequest lifecycle : java.util.Arrays.asList(null, timedLifecycle())) {
            ApiException create = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "资格窗口", null, 10, lifecycle, null)));
            assertField(create, "results", "REQUIRED");
            ApiException update = assertThrows(ApiException.class, () -> service.update(GAME_ID, SKILL_KEY, EFFECT_KEY,
                new SkillEffectUpdateRequest(null, "资格窗口", null, 10, lifecycle, null)));
            assertField(update, "results", "REQUIRED");
        }
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any(), any(), any());
        verify(mapper, never()).updateEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void lifecycleOnlyEffectStillRejectsRemovingLifecycleInvalidLifecycleAndUnusedPeriodicSettings() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(
            EFFECT_KEY, "资格窗口", null, 10, timedLifecycle(), List.of()));
        SkillEffectRow before = savedEffect;
        ApiException empty = assertThrows(ApiException.class, () -> service.update(GAME_ID, SKILL_KEY, EFFECT_KEY,
            new SkillEffectUpdateRequest(null, "资格窗口", null, 10, null, List.of())));
        assertField(empty, "results", "REQUIRED");

        SkillEffectLifecycleRequest valid = timedLifecycle();
        SkillEffectLifecycleRequest invalid = new SkillEffectLifecycleRequest(
            valid.durationValue(), valid.maxStacksValue(), valid.applicationStacksValue(), null,
            valid.reapplicationStackMode(), valid.reapplicationDurationMode(), valid.expiryMode(), null, null);
        SkillEffectLifecycleRequest periodic = new SkillEffectLifecycleRequest(
            valid.durationValue(), valid.maxStacksValue(), valid.applicationStacksValue(), valid.instanceScope(),
            valid.reapplicationStackMode(), valid.reapplicationDurationMode(), valid.expiryMode(),
            SkillNumericValue.formula(PERIODIC_FORMULA), SkillEffectLifecycleFirstPeriodicExecution.AFTER_INTERVAL);
        for (SkillEffectLifecycleRequest lifecycle : List.of(invalid, periodic)) {
            String field = lifecycle == invalid ? "lifecycle.instanceScope" : "lifecycle.periodicIntervalValue";
            ApiException create = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
                new SkillEffectCreateRequest(EFFECT_KEY, "资格窗口", null, 10, lifecycle, List.of())));
            assertTrue(fieldIssues(create).stream().anyMatch(issue -> field.equals(issue.get("field"))));
            ApiException update = assertThrows(ApiException.class, () -> service.update(GAME_ID, SKILL_KEY, EFFECT_KEY,
                new SkillEffectUpdateRequest(null, "资格窗口", null, 10, lifecycle, List.of())));
            assertTrue(fieldIssues(update).stream().anyMatch(issue -> field.equals(issue.get("field"))));
        }
        assertEquals(before, savedEffect);
        verify(mapper, never()).updateEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void removingLastReferencedResultToKeepOnlyLifecycleIsRejectedBeforeWrite() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> savedEffect);
        service.create(GAME_ID, SKILL_KEY, new SkillEffectCreateRequest(EFFECT_KEY, "伤害窗口", null, 10,
            timedLifecycle(), List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))));
        SkillEffectRow before = savedEffect;
        org.mockito.Mockito.doThrow(new ApiException(org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_EFFECT_IN_USE", "结果仍被引用", Map.of()))
            .when(triggerRuleService).assertEffectUpdate(eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), any(),
                eq(timedLifecycle()), eq(List.of()), eq(List.of("physical_hit")));
        assertCode("409.SKILL_EFFECT_IN_USE", () -> service.update(GAME_ID, SKILL_KEY, EFFECT_KEY,
            new SkillEffectUpdateRequest(null, "资格窗口", null, 10, timedLifecycle(), List.of())));
        assertEquals(before, savedEffect);
        verify(mapper, never()).updateEffect(any(), any(), any(), any(), any(), any(), any(), any());
    }

    private int saveAggregate(org.mockito.invocation.InvocationOnMock invocation) {
        savedEffect = new SkillEffectRow(invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2),
            invocation.getArgument(3), invocation.getArgument(4), invocation.getArgument(5),
            invocation.getArgument(6), invocation.getArgument(7), TS, TS);
        return 1;
    }

    @Test
    void savesAndReadsRootJsonWithExactDecimalsExplicitNullsAndCanonicalResultOrder() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> readEffect());
        BigDecimal multiplier = new BigDecimal("12345678901234567890.1234567890123456789");
        SkillEffectResultRequest precise = new SkillEffectResultRequest(
            "z_heal", "精确治疗", SkillEffectResultType.DIRECT_HEAL, SkillEffectTarget.SOURCE, null, 10,
            new SkillEffectValueRuleRequest(SkillNumericValue.formula(FORMULA_KEY), multiplier, null, null), new SkillEffectDirectHealDetail(), null, null
        );
        SkillEffectResultRequest damage = damageResult("a_damage");
        SkillEffectDetailResponse created = service.create(GAME_ID, SKILL_KEY,
            new SkillEffectCreateRequest(EFFECT_KEY, "命中结果", null, 10, List.of(precise, damage)));

        assertNull(savedEffect.lifecycle());
        var stored = AggregateJson.tree(savedEffect.results());
        assertEquals("a_damage", stored.get(0).path("resultKey").asText());
        assertEquals("z_heal", stored.get(1).path("resultKey").asText());
        assertEquals(0, multiplier.compareTo(stored.get(1).path("valueRule").path("fixedMultiplier").decimalValue()));
        assertTrue(stored.get(1).has("spellShieldBlockScope"));
        assertTrue(stored.get(1).get("spellShieldBlockScope").isNull());
        assertTrue(stored.get(1).get("lifecycleBehavior").isNull());
        assertFalse(stored.get(0).path("detail").has("resultType"));
        assertFalse(stored.get(0).path("detail").has("foreignFields"));
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        SkillEffectDetailResponse readBack = service.get(GAME_ID, SKILL_KEY, EFFECT_KEY);
        assertEquals(created, readBack);
        assertEquals(0, multiplier.compareTo(readBack.results().get(1).valueRule().fixedMultiplier()));
        verify(mapper).insertEffect(eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), any(), any(), any(), any(), isNull());
    }

    private SkillEffectRow readEffect() {
        return savedEffect == null ? fixtureRow(false) : savedEffect;
    }

    private SkillEffectRow fixtureRow(boolean forUpdate) {
        String resultsKey = forUpdate ? "listResultsForUpdate" : "listResults";
        String lifecycleKey = forUpdate ? "findLifecycleForUpdate" : "findLifecycle";
        List<ObjectNode> results = fixtureRows(resultsKey).stream().map(row -> {
            ObjectNode result = row.deepCopy();
            String key = result.path("resultKey").asText();
            result.remove(List.of("gameId", "skillKey", "effectKey"));
            result.set("valueRule", fixturePart("listValues", key));
            ObjectNode policy = fixturePart("listSpellShieldPolicies", key);
            result.set("spellShieldBlockScope", policy == null ? null : policy.get("blockScope"));
            result.set("lifecycleBehavior", fixturePart("listLifecycleBehaviors", key));
            String detailRows = switch (result.path("resultType").asText()) {
                case "DAMAGE" -> "listDamageDetails";
                case "NORMAL_SHIELD" -> "listNormalShieldInteractions";
                case "ATTRIBUTE_CHANGE" -> "listAttributeChangeDetails";
                case "RESOURCE_CHANGE" -> "listResourceChangeDetails";
                case "COOLDOWN_CHANGE" -> "listCooldownChangeDetails";
                case "SKILL_HASTE_MODIFIER" -> "listHasteModifierDetails";
                case "STATUS_OPERATION" -> "listStatusOperationDetails";
                case "LIFECYCLE_OPERATION" -> "listLifecycleOperationDetails";
                case "DAMAGE_MODIFIER" -> "listDamageModifierDetails";
                case "HEALING_MODIFIER" -> "listHealingModifierDetails";
                case "DAMAGE_IMMUNITY" -> "listDamageImmunityDetails";
                case "HEALTH_FLOOR" -> "listHealthFloorDetails";
                case "EXECUTE" -> "listExecuteDetails";
                default -> null;
            };
            ObjectNode detail = detailRows == null ? emptyJson() : fixturePart(detailRows, key);
            if (detail == null) detail = emptyJson();
            if (result.path("resultType").asText().equals("DAMAGE")) {
                ObjectNode critical = fixturePart("listCriticalPolicies", key);
                if (critical != null) critical.set("mode", critical.remove("criticalMode"));
                detail.set("critical", critical);
                var vamp = detail.putArray("vampOverrides");
                fixtureRows("listVampOverrides").stream().filter(item -> item.path("resultKey").asText().equals(key))
                    .forEach(item -> { item.remove(List.of("gameId", "skillKey", "effectKey", "resultKey")); vamp.add(item); });
                detail.put("vampQualification", vamp.isEmpty() ? "UNRESOLVED" : "RESOLVED");
            }
            if (result.path("resultType").asText().equals("COOLDOWN_CHANGE") || result.path("resultType").asText().equals("SKILL_HASTE_MODIFIER")) {
                ObjectNode scope = fixturePart("listSkillScopes", key);
                if (scope == null) scope = emptyJson();
                var skills = scope.putArray("skillKeys");
                fixtureRows("listSkillTargets").stream().filter(item -> item.path("resultKey").asText().equals(key))
                    .forEach(item -> skills.add(item.path("affectedSkillKey").asText()));
                var categories = scope.putArray("skillCategoryKeys");
                fixtureRows("listSkillCategoryTargets").stream().filter(item -> item.path("resultKey").asText().equals(key))
                    .forEach(item -> categories.add(item.path("skillCategoryKey").asText()));
                detail.set("affectedSkillScope", scope);
            }
            result.set("detail", detail);
            return result;
        }).toList();
        Object lifecycle = fixture.get(lifecycleKey);
        ObjectNode lifecycleJson = lifecycle == null ? null : (ObjectNode) AggregateJson.tree(AggregateJson.write(lifecycle));
        if (lifecycleJson != null) lifecycleJson.remove(List.of("gameId", "skillKey", "effectKey"));
        return new SkillEffectRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "命中结果", null, 10,
            AggregateJson.write(results), lifecycleJson == null ? null : AggregateJson.write(lifecycleJson), TS, TS);
    }

    private ObjectNode fixturePart(String name, String key) {
        return fixtureRows(name).stream().filter(row -> row.path("resultKey").asText().equals(key)).findFirst()
            .map(row -> { row.remove(List.of("gameId", "skillKey", "effectKey", "resultKey")); return row; }).orElse(null);
    }

    private List<ObjectNode> fixtureRows(String name) {
        Object rows = fixture.getOrDefault(name, List.of());
        if (rows == null) return List.of();
        List<ObjectNode> parsed = new ArrayList<>();
        AggregateJson.tree(AggregateJson.write(rows)).forEach(row -> parsed.add((ObjectNode) row));
        return parsed;
    }

    private static ObjectNode emptyJson() { return (ObjectNode) AggregateJson.tree("{}"); }

    private void stubParentAndNewKey() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
    }

    @SuppressWarnings("unchecked")
    private void stubEnabledCatalogs() {
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> new ArrayList<>((Collection<String>) invocation.getArgument(2)));
        when(mapper.lockDamageTypes(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockAttributes(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockSkills(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockSkillCategories(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockStatuses(eq(GAME_ID), anyCollection())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(1);
            return keys.stream().map(key -> new xyz.game.datamanage.model.skilleffect.SkillEffectStatusLockRow(
                key, "ENABLED", xyz.game.datamanage.model.status.StatusKind.STUN)).toList();
        });
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Collection<String> keys = (Collection<String>) invocation.getArgument(1);
            List<SkillEffectModifierZoneLockRow> rows = new ArrayList<>();
            for (String key : keys) {
                ModifierZoneDomain domain = HEALING_ZONE_KEY.equals(key)
                    ? ModifierZoneDomain.HEALING
                    : ModifierZoneDomain.DAMAGE;
                rows.add(new SkillEffectModifierZoneLockRow(
                    key, domain, ModifierZoneCalculationMode.RATIO_ADD, ModifierZoneStatus.ENABLED));
            }
            return rows;
        });
    }

    @SuppressWarnings("unchecked")
    private List<SkillEffectCatalogLockRow> enabledLocks(org.mockito.invocation.InvocationOnMock invocation) {
        Collection<String> keys = (Collection<String>) invocation.getArgument(1);
        List<SkillEffectCatalogLockRow> rows = new ArrayList<>();
        for (String key : keys) {
            rows.add(new SkillEffectCatalogLockRow(key, "ENABLED"));
        }
        return rows;
    }

    private void stubDetailRead(
        List<SkillEffectResultRow> results,
        List<SkillEffectResultValueRow> values,
        DetailBundle details
    ) {
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenAnswer(invocation -> readEffect());
        fixture.put("listResults", results);
        fixture.put("listValues", values);
        fixture.put("listDamageDetails", details.damage);
        fixture.put("listCriticalPolicies", results.stream()
                .filter(row -> row.resultType() == SkillEffectResultType.DAMAGE)
                .map(row -> new SkillEffectCriticalPolicyRow(
                    row.gameId(), row.skillKey(), row.effectKey(), row.resultKey(),
                    SkillEffectCriticalMode.DISALLOWED, null
                ))
                .toList());
        fixture.put("listVampOverrides", List.of());
        fixture.put("listNormalShieldInteractions", results.stream()
                .filter(row -> row.resultType() == SkillEffectResultType.NORMAL_SHIELD)
                .map(row -> new SkillEffectNormalShieldInteractionRow(
                    row.gameId(), row.skillKey(), row.effectKey(), row.resultKey(),
                    null, SkillEffectNormalShieldDecayMode.NONE
                ))
                .toList());
        fixture.put("listAttributeChangeDetails", details.attributes);
        fixture.put("listResourceChangeDetails", details.resources);
        fixture.put("listCooldownChangeDetails", details.cooldowns);
        List<SkillEffectSkillScopeRow> scopes = details.skillScopes;
        List<SkillEffectSkillTargetRow> skillTargets = details.skillTargets;
        if (scopes.isEmpty() && skillTargets.isEmpty() && !details.cooldowns.isEmpty()) {
            scopes = details.cooldowns.stream()
                .map(row -> new SkillEffectSkillScopeRow(
                    row.gameId(), row.skillKey(), row.effectKey(), row.resultKey(),
                    SkillEffectSkillScopeMode.SKILLS
                ))
                .toList();
            skillTargets = details.cooldowns.stream()
                .map(row -> new SkillEffectSkillTargetRow(
                    row.gameId(), row.skillKey(), row.effectKey(), row.resultKey(), SKILL_KEY
                ))
                .toList();
        }
        fixture.put("listSkillScopes", scopes);
        fixture.put("listSkillTargets", skillTargets);
        fixture.put("listSkillCategoryTargets", details.skillCategoryTargets);
        fixture.put("listHasteModifierDetails", details.hasteModifiers);
        fixture.put("listStatusOperationDetails", details.statuses);
    }

    private static SkillEffectCreateRequest createSixNonShieldResults() {
        return new SkillEffectCreateRequest(
            EFFECT_KEY,
            "命中结果",
            null,
            10,
            List.of(
                damageResult("physical_hit"),
                healResult("direct_heal"),
                attributeResult("buff_ad"),
                resourceResult("consume_mp"),
                cooldownReduceResult("reset_self", SKILL_KEY),
                statusResult("apply_poison")
            )
        );
    }

    private static SkillEffectCreateRequest createDamageOnly() {
        return new SkillEffectCreateRequest(
            EFFECT_KEY, "命中结果", null, 10, List.of(damageResult("physical_hit"))
        );
    }

    private static SkillEffectResultRequest damageResult(String resultKey) {
        return new SkillEffectResultRequest(
            resultKey,
            "物理伤害",
            SkillEffectResultType.DAMAGE,
            SkillEffectTarget.TARGET,
            null,
            0,
            valueRule(),
            new SkillEffectDamageDetail("physical")
        );
    }

    private static SkillEffectResultRequest healResult(String resultKey) {
        return new SkillEffectResultRequest(
            resultKey,
            "直接治疗",
            SkillEffectResultType.DIRECT_HEAL,
            SkillEffectTarget.SOURCE,
            null,
            1,
            valueRule(),
            new SkillEffectDirectHealDetail()
        );
    }

    private static SkillEffectResultRequest shieldResult(String resultKey) {
        return new SkillEffectResultRequest(
            resultKey,
            "普通护盾",
            SkillEffectResultType.NORMAL_SHIELD,
            SkillEffectTarget.SOURCE,
            null,
            2,
            valueRule(),
            new SkillEffectNormalShieldDetail()
        );
    }

    private static SkillEffectResultRequest attributeResult(String resultKey) {
        return new SkillEffectResultRequest(
            resultKey,
            "增加攻击",
            SkillEffectResultType.ATTRIBUTE_CHANGE,
            SkillEffectTarget.SOURCE,
            null,
            3,
            valueRule(),
            new SkillEffectAttributeChangeDetail("ad", SkillEffectAttributeChangeOperation.INCREASE)
        );
    }

    private static SkillEffectResultRequest resourceResult(String resultKey) {
        return new SkillEffectResultRequest(
            resultKey,
            "消耗法力",
            SkillEffectResultType.RESOURCE_CHANGE,
            SkillEffectTarget.SOURCE,
            null,
            4,
            valueRule(),
            new SkillEffectResourceChangeDetail("mp", SkillEffectResourceChangeOperation.CONSUME)
        );
    }

    private static SkillEffectResultRequest cooldownReduceResult(String resultKey, String affectedSkillKey) {
        return cooldownReduceResult(resultKey, List.of(affectedSkillKey));
    }

    private static SkillEffectResultRequest cooldownReduceResult(String resultKey, List<String> affectedSkillKeys) {
        return new SkillEffectResultRequest(
            resultKey,
            "减少冷却",
            SkillEffectResultType.COOLDOWN_CHANGE,
            SkillEffectTarget.SOURCE,
            null,
            5,
            valueRule(),
            new SkillEffectCooldownChangeDetail(
                skillsScope(affectedSkillKeys),
                SkillEffectCooldownChangeOperation.REDUCE
            )
        );
    }

    private static SkillEffectResultRequest cooldownResetResult(String resultKey, String affectedSkillKey) {
        return new SkillEffectResultRequest(
            resultKey,
            "重置冷却",
            SkillEffectResultType.COOLDOWN_CHANGE,
            SkillEffectTarget.SOURCE,
            null,
            5,
            null,
            new SkillEffectCooldownChangeDetail(
                skillsScope(List.of(affectedSkillKey)),
                SkillEffectCooldownChangeOperation.RESET
            )
        );
    }

    private static SkillEffectResultRequest statusResult(String resultKey) {
        return new SkillEffectResultRequest(
            resultKey,
            "施加中毒",
            SkillEffectResultType.STATUS_OPERATION,
            SkillEffectTarget.TARGET,
            null,
            6,
            null,
            new SkillEffectStatusOperationDetail("poison", SkillEffectStatusOperation.APPLY)
        );
    }

    private static SkillEffectResultRequest persistentDamageModifierWithScope(
        SkillEffectSpellShieldBlockScope scope
    ) {
        SkillEffectResultRequest source = persistentDamageModifierResult();
        return new SkillEffectResultRequest(
            source.resultKey(), source.name(), source.resultType(), SkillEffectTarget.TARGET,
            source.description(), source.sortOrder(), source.valueRule(), source.detail(), source.lifecycleBehavior(), scope
        );
    }

    private static SkillEffectResultRequest conditionedModifier(com.fasterxml.jackson.databind.JsonNode condition,
        SkillEffectTarget target, SkillEffectDamageModifierDirection direction) {
        SkillEffectResultRequest source = persistentDamageModifierResult();
        SkillEffectDamageModifierDetail detail = (SkillEffectDamageModifierDetail) source.detail();
        return new SkillEffectResultRequest(source.resultKey(), source.name(), source.resultType(), target,
            source.description(), source.sortOrder(), source.valueRule(),
            new SkillEffectDamageModifierDetail(detail.modifierZoneKey(), direction, detail.operation(),
                detail.damageTypeKey(), detail.deliveryKind(), detail.originKind(), detail.criticalFilter(), condition),
            source.lifecycleBehavior());
    }

    private static SkillEffectResultRequest persistentDamageModifierResult() {
        return new SkillEffectResultRequest(
            "damage_reduction",
            "受到伤害降低",
            SkillEffectResultType.DAMAGE_MODIFIER,
            SkillEffectTarget.SOURCE,
            null,
            0,
            valueRule(),
            new SkillEffectDamageModifierDetail(
                DAMAGE_ZONE_KEY,
                SkillEffectDamageModifierDirection.TAKEN,
                SkillEffectModifierOperation.DECREASE,
                "physical",
                SkillEffectDamageFilterDeliveryKind.ANY,
                SkillEffectDamageFilterOriginKind.DIRECT,
                SkillEffectCriticalFilter.ANY
            ),
            persistentShared()
        );
    }

    private static SkillEffectResultRequest persistentHealingModifierResult() {
        return new SkillEffectResultRequest(
            "healing_reduction",
            "受到治疗降低",
            SkillEffectResultType.HEALING_MODIFIER,
            SkillEffectTarget.SOURCE,
            null,
            1,
            valueRule(),
            new SkillEffectHealingModifierDetail(
                HEALING_ZONE_KEY,
                SkillEffectHealingModifierDirection.RECEIVED,
                SkillEffectModifierOperation.DECREASE,
                SkillEffectHealingKind.ANY
            ),
            persistentShared()
        );
    }

    private static SkillEffectResultRequest persistentDamageImmunityResult() {
        return new SkillEffectResultRequest(
            "damage_immunity",
            "技能伤害免疫",
            SkillEffectResultType.DAMAGE_IMMUNITY,
            SkillEffectTarget.SOURCE,
            null,
            2,
            null,
            new SkillEffectDamageImmunityDetail(
                null,
                SkillEffectDamageFilterDeliveryKind.SKILL,
                SkillEffectDamageFilterOriginKind.ANY
            ),
            new SkillEffectResultLifecycleBehaviorRequest(
                SkillEffectLifecycleMoment.PERSISTENT,
                null,
                null,
                null,
                null
            )
        );
    }

    private static SkillEffectResultRequest persistentHealthFloorResult() {
        return new SkillEffectResultRequest(
            "health_floor",
            "生命下限",
            SkillEffectResultType.HEALTH_FLOOR,
            SkillEffectTarget.SOURCE,
            null,
            3,
            valueRule(),
            new SkillEffectHealthFloorDetail("hp"),
            persistentShared()
        );
    }

    private static SkillEffectValueRuleRequest valueRule() {
        return new SkillEffectValueRuleRequest(SkillNumericValue.formula(FORMULA_KEY), BigDecimal.ONE, null, null);
    }

    private static List<SkillEffectResultRow> sixNonShieldResultRows() {
        return List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE),
            resultRow("direct_heal", SkillEffectResultType.DIRECT_HEAL),
            resultRow("buff_ad", SkillEffectResultType.ATTRIBUTE_CHANGE),
            resultRow("consume_mp", SkillEffectResultType.RESOURCE_CHANGE),
            resultRow("reset_self", SkillEffectResultType.COOLDOWN_CHANGE),
            resultRow("apply_poison", SkillEffectResultType.STATUS_OPERATION)
        );
    }

    private static List<SkillEffectResultValueRow> sixNonShieldValueRows() {
        return List.of(
            valueRow("physical_hit"),
            valueRow("direct_heal"),
            valueRow("buff_ad"),
            valueRow("consume_mp"),
            valueRow("reset_self")
        );
    }

    private static DetailBundle sixNonShieldDetails() {
        return new DetailBundle(
            List.of(new SkillEffectDamageDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
            )),
            List.of(new SkillEffectAttributeChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "buff_ad", "ad",
                SkillEffectAttributeChangeOperation.INCREASE, null
            )),
            List.of(new SkillEffectResourceChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "consume_mp", "mp",
                SkillEffectResourceChangeOperation.CONSUME
            )),
            List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reset_self", SkillEffectCooldownChangeOperation.REDUCE
            )),
            List.of(new SkillEffectStatusOperationDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "apply_poison", "poison",
                SkillEffectStatusOperation.APPLY
            ))
        );
    }

    private static SkillEffectResultRow resultRow(String resultKey, SkillEffectResultType type) {
        return new SkillEffectResultRow(
            GAME_ID, SKILL_KEY, EFFECT_KEY, resultKey, resultKey, type, SkillEffectTarget.TARGET, null, 0
        );
    }

    private static SkillEffectResultValueRow valueRow(String resultKey) {
        return new SkillEffectResultValueRow(
            GAME_ID, SKILL_KEY, EFFECT_KEY, resultKey, SkillNumericValue.formula(FORMULA_KEY), BigDecimal.ONE, null, null
        );
    }

    private static SkillEffectSummaryResponse summary() {
        return new SkillEffectSummaryResponse(GAME_ID, SKILL_KEY, EFFECT_KEY, "命中结果", null, 10, 2, TS, TS);
    }

    private static SkillRow skill() {
        return new SkillRow(GAME_ID, SKILL_KEY, "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS);
    }

    private static SkillRow disabledSkill() {
        return new SkillRow(GAME_ID, SKILL_KEY, "秘术射击", null, 5, SkillStatus.DISABLED, 10, TS, TS);
    }

    private static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> fieldIssues(ApiException exception) {
        return (List<Map<String, String>>) exception.getDetails().get("fieldIssues");
    }

    private static void assertField(ApiException exception, String field, String code) {
        List<Map<String, String>> issues = fieldIssues(exception);
        assertTrue(
            issues.stream().anyMatch(issue -> field.equals(issue.get("field")) && code.equals(issue.get("code"))),
            () -> "expected " + field + "/" + code + " but was " + issues
        );
    }

    private static SkillEffectLifecycleRequest timedLifecycle() {
        return new SkillEffectLifecycleRequest(
            SkillNumericValue.formula(DURATION_FORMULA),
            SkillNumericValue.formula(MAX_STACKS_FORMULA),
            SkillNumericValue.formula(APP_STACKS_FORMULA),
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.INCREASE,
            SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL,
            SkillEffectLifecycleExpiryMode.ALL_AT_ONCE,
            null,
            null
        );
    }

    private static SkillEffectResultLifecycleBehaviorRequest applicationSnapshot() {
        return new SkillEffectResultLifecycleBehaviorRequest(
            SkillEffectLifecycleMoment.APPLICATION,
            SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
            null,
            null,
            null
        );
    }

    private static SkillEffectResultRequest damageResultWithBehavior(
        String resultKey,
        SkillEffectResultLifecycleBehaviorRequest behavior
    ) {
        return new SkillEffectResultRequest(
            resultKey,
            "物理伤害",
            SkillEffectResultType.DAMAGE,
            SkillEffectTarget.TARGET,
            null,
            0,
            valueRule(),
            new SkillEffectDamageDetail("physical"),
            behavior
        );
    }

    private static SkillEffectResultRequest shieldResultWithBehavior(
        String resultKey,
        SkillEffectResultLifecycleBehaviorRequest behavior
    ) {
        return shieldResultWithBehavior(resultKey, new SkillEffectNormalShieldDetail(), behavior);
    }

    private static SkillEffectResultRequest shieldResultWithBehavior(
        String resultKey,
        SkillEffectNormalShieldDetail detail,
        SkillEffectResultLifecycleBehaviorRequest behavior
    ) {
        return new SkillEffectResultRequest(
            resultKey,
            "普通护盾",
            SkillEffectResultType.NORMAL_SHIELD,
            SkillEffectTarget.SOURCE,
            null,
            2,
            valueRule(),
            detail,
            behavior
        );
    }

    private static SkillEffectResultLifecycleBehaviorRequest persistentShared() {
        return new SkillEffectResultLifecycleBehaviorRequest(
            SkillEffectLifecycleMoment.PERSISTENT,
            SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
            SkillEffectLifecycleStackValueMode.SHARED,
            SkillEffectLifecycleReapplicationValueMode.KEEP,
            null
        );
    }

    private static SkillEffectResultRequest statusResultWithBehavior(
        String resultKey,
        SkillEffectResultLifecycleBehaviorRequest behavior
    ) {
        return statusResultWithScope(
            resultKey,
            SkillEffectTarget.TARGET,
            SkillEffectStatusOperation.APPLY,
            behavior,
            null
        );
    }

    private static SkillEffectResultRequest statusResultWithScope(
        SkillEffectTarget target,
        SkillEffectStatusOperation operation,
        SkillEffectResultLifecycleBehaviorRequest behavior,
        SkillEffectSpellShieldBlockScope scope
    ) {
        return statusResultWithScope("apply_poison", target, operation, behavior, scope);
    }

    private static SkillEffectResultRequest statusResultWithScope(
        String resultKey,
        SkillEffectTarget target,
        SkillEffectStatusOperation operation,
        SkillEffectResultLifecycleBehaviorRequest behavior,
        SkillEffectSpellShieldBlockScope scope
    ) {
        return new SkillEffectResultRequest(
            resultKey,
            "施加中毒",
            SkillEffectResultType.STATUS_OPERATION,
            target,
            null,
            6,
            null,
            new SkillEffectStatusOperationDetail("poison", operation),
            behavior,
            scope
        );
    }

    private static SkillEffectResultLifecycleBehaviorRequest persistentStatusBehavior() {
        return new SkillEffectResultLifecycleBehaviorRequest(
            SkillEffectLifecycleMoment.PERSISTENT,
            null,
            null,
            null,
            null
        );
    }

    private static SkillEffectResultRequest lifecycleOpResult(
        String resultKey,
        SkillEffectLifecycleOperation operation,
        String targetEffectKey,
        SkillEffectValueRuleRequest valueRule,
        SkillEffectResultLifecycleBehaviorRequest behavior
    ) {
        return new SkillEffectResultRequest(
            resultKey,
            "生命周期操作",
            SkillEffectResultType.LIFECYCLE_OPERATION,
            SkillEffectTarget.TARGET,
            null,
            0,
            valueRule,
            new SkillEffectLifecycleOperationDetail(targetEffectKey, operation),
            behavior
        );
    }

    private static SkillEffectLifecycleRow lifecycleRow() {
        return lifecycleRowFor(EFFECT_KEY, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE);
    }

    private static SkillEffectLifecycleRow lifecycleRowFor(
        String effectKey,
        SkillEffectLifecycleExpiryMode expiryMode
    ) {
        return new SkillEffectLifecycleRow(
            GAME_ID,
            SKILL_KEY,
            effectKey,
            SkillNumericValue.formula(DURATION_FORMULA),
            SkillNumericValue.formula(MAX_STACKS_FORMULA),
            SkillNumericValue.formula(APP_STACKS_FORMULA),
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.INCREASE,
            SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL,
            expiryMode,
            null,
            null
        );
    }

    private static SkillEffectLifecycleRow lifecycleRowWithoutDuration(String effectKey) {
        return new SkillEffectLifecycleRow(
            GAME_ID,
            SKILL_KEY,
            effectKey,
            null,
            SkillNumericValue.formula(MAX_STACKS_FORMULA),
            SkillNumericValue.formula(APP_STACKS_FORMULA),
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.KEEP,
            null,
            SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY,
            null,
            null
        );
    }

    private static SkillEffectResultRequest hasteIncreaseResult(
        String resultKey,
        SkillEffectAffectedSkillScope scope
    ) {
        return new SkillEffectResultRequest(
            resultKey,
            "增加技能急速",
            SkillEffectResultType.SKILL_HASTE_MODIFIER,
            SkillEffectTarget.SOURCE,
            null,
            0,
            valueRule(),
            new SkillEffectHasteModifierDetail(scope, SkillEffectModifierOperation.INCREASE),
            persistentShared()
        );
    }

    private static SkillEffectAffectedSkillScope skillsScope(List<String> skillKeys) {
        return new SkillEffectAffectedSkillScope(SkillEffectSkillScopeMode.SKILLS, skillKeys, List.of());
    }

    private static SkillEffectAffectedSkillScope allScope() {
        return new SkillEffectAffectedSkillScope(SkillEffectSkillScopeMode.ALL, List.of(), List.of());
    }

    private static SkillEffectAffectedSkillScope categoriesScope(List<String> categoryKeys) {
        return new SkillEffectAffectedSkillScope(SkillEffectSkillScopeMode.CATEGORIES, List.of(), categoryKeys);
    }

    private record DetailBundle(
        List<SkillEffectDamageDetailRow> damage,
        List<SkillEffectAttributeChangeDetailRow> attributes,
        List<SkillEffectResourceChangeDetailRow> resources,
        List<SkillEffectCooldownChangeDetailRow> cooldowns,
        List<SkillEffectStatusOperationDetailRow> statuses,
        List<SkillEffectSkillScopeRow> skillScopes,
        List<SkillEffectSkillTargetRow> skillTargets,
        List<SkillEffectSkillCategoryTargetRow> skillCategoryTargets,
        List<SkillEffectHasteModifierDetailRow> hasteModifiers
    ) {
        DetailBundle(
            List<SkillEffectDamageDetailRow> damage,
            List<SkillEffectAttributeChangeDetailRow> attributes,
            List<SkillEffectResourceChangeDetailRow> resources,
            List<SkillEffectCooldownChangeDetailRow> cooldowns,
            List<SkillEffectStatusOperationDetailRow> statuses
        ) {
            this(damage, attributes, resources, cooldowns, statuses, List.of(), List.of(), List.of(), List.of());
        }
    }
}
