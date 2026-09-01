package xyz.game.datamanage.service.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
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
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCatalogLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeTargetRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicy;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicyRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalFilter;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageFilterDeliveryKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageFilterOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageImmunityDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageImmunityDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDirection;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDeliveryKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectDirectHealDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDirection;
import xyz.game.datamanage.model.skilleffect.SkillEffectExecuteDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectExecuteDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectHitLinkApplicationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttackLinkApplicationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealthFloorDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealthFloorDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleFirstPeriodicExecution;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperationDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecyclePeriodicExecutionMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationDurationMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationStackMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleStackValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleValueReadMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDecayMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldInteractionRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierZoneLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultValueRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldBlockScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldPolicyRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampBasisOutputKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampRule;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampRuleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampType;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillEffectServiceTest {

    private static final String GAME_ID = "lol";
    private static final String SKILL_KEY = "ezreal_q";
    private static final String EFFECT_KEY = "on_hit_results";
    private static final String TARGET_EFFECT_KEY = "mark_effect";
    private static final String FORMULA_KEY = "base_damage";
    private static final String DAMAGE_ZONE_KEY = "damage_ratio";
    private static final String HEALING_ZONE_KEY = "healing_ratio";
    private static final String DURATION_FORMULA = "duration_f";
    private static final String MAX_STACKS_FORMULA = "max_stacks_f";
    private static final String APP_STACKS_FORMULA = "app_stacks_f";
    private static final String PERIODIC_FORMULA = "periodic_f";
    private static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-27T00:00:00Z");

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillEffectMapper mapper;

    private SkillEffectService service;

    @BeforeEach
    void setUp() {
        service = new SkillEffectService(gamesMapper, skillMapper, mapper);
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
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
        stubAllInserts();
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
        assertEquals(FORMULA_KEY, detail.results().get(4).valueRule().formulaKey());
        assertEquals(SkillEffectResultType.STATUS_OPERATION, detail.results().get(5).resultType());
        assertNull(detail.results().get(5).valueRule());

        InOrder order = inOrder(skillMapper, mapper);
        order.verify(skillMapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(mapper).lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection());
        order.verify(mapper).lockDamageTypes(eq(GAME_ID), anyCollection());
        order.verify(mapper).lockAttributes(eq(GAME_ID), anyCollection());
        order.verify(mapper).lockSkills(eq(GAME_ID), anyCollection());
        order.verify(mapper).lockStatuses(eq(GAME_ID), anyCollection());
        order.verify(mapper).insertEffect(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("命中结果"), isNull(), eq(10)
        );
        verify(mapper).insertDamageDetail(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            "physical_hit",
            "physical",
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.DIRECT
        );
        verify(mapper).insertValue(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("reset_self"),
            eq(FORMULA_KEY), eq(BigDecimal.ONE), isNull(), isNull()
        );
        verify(mapper, never()).insertValue(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("apply_poison"),
            any(), any(), any(), any()
        );
        verify(mapper).insertStatusOperationDetail(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "apply_poison", "poison", SkillEffectStatusOperation.APPLY
        );
    }

    @Test
    void createsPersistentSpellShieldAndBlockableDamage() {
        stubParentAndNewKey();
        stubAllInserts();
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
        when(mapper.findLifecycle(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());
        when(mapper.listLifecycleBehaviors(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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
        when(mapper.listSpellShieldPolicies(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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

        assertInstanceOf(SkillEffectSpellShieldDetail.class, response.results().get(0).detail());
        assertEquals(
            SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE,
            response.results().get(1).spellShieldBlockScope()
        );
        verify(mapper).insertSpellShieldPolicy(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
            SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE
        );
        verify(mapper, never()).insertValue(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("spell_shield"),
            any(), any(), any(), any()
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
        stubAllInserts();
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
        when(mapper.listExecuteDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectExecuteDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "execute", "hp")
        ));
        when(mapper.listLifecycleBehaviors(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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
        when(mapper.listSpellShieldPolicies(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectSpellShieldPolicyRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "execute", SkillEffectSpellShieldBlockScope.RESULT
            )
        ));

        when(mapper.findLifecycle(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());

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
        verify(mapper).insertExecuteDetail(GAME_ID, SKILL_KEY, EFFECT_KEY, "execute", "hp");
        verify(mapper).insertValue(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("hit_link"),
            eq(FORMULA_KEY), eq(BigDecimal.ONE), isNull(), isNull()
        );
        verify(mapper).insertSpellShieldPolicy(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "execute", SkillEffectSpellShieldBlockScope.RESULT
        );

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
        stubAllInserts();
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
        when(mapper.findLifecycle(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());
        when(mapper.listLifecycleBehaviors(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            rows.stream().map(row -> new SkillEffectResultLifecycleBehaviorRow(
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
            )).toList()
        );
        when(mapper.listDamageModifierDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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
        when(mapper.listHealingModifierDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectHealingModifierDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "healing_reduction",
                HEALING_ZONE_KEY,
                SkillEffectHealingModifierDirection.RECEIVED,
                SkillEffectModifierOperation.DECREASE,
                SkillEffectHealingKind.ANY
            )
        ));
        when(mapper.listDamageImmunityDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectDamageImmunityDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "damage_immunity", null,
                SkillEffectDamageFilterDeliveryKind.SKILL,
                SkillEffectDamageFilterOriginKind.ANY
            )
        ));
        when(mapper.listHealthFloorDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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
        verify(mapper).insertDamageModifierDetail(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "damage_reduction",
            DAMAGE_ZONE_KEY,
            SkillEffectDamageModifierDirection.TAKEN,
            SkillEffectModifierOperation.DECREASE,
            "physical",
            SkillEffectDamageFilterDeliveryKind.ANY,
            SkillEffectDamageFilterOriginKind.DIRECT,
            SkillEffectCriticalFilter.ANY
        );
        verify(mapper).insertDamageImmunityDetail(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "damage_immunity", null,
            SkillEffectDamageFilterDeliveryKind.SKILL,
            SkillEffectDamageFilterOriginKind.ANY
        );
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

        assertField(exception, "results[0].valueRule.formulaKey", "RUNTIME_INPUT_FORBIDDEN");
    }

    @Test
    void createsDamageCriticalAndVampRulesAndReadsCanonicalShape() {
        stubParentAndNewKey();
        stubAllInserts();
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
        when(mapper.listCriticalPolicies(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectCriticalPolicyRow(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                "physical_hit",
                SkillEffectCriticalMode.SOURCE_CRIT_CHANCE,
                "crit_multiplier"
            )
        ));
        when(mapper.listVampRules(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectVampRuleRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectVampType.LIFE_STEAL,
                SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE,
                "life_steal_efficiency"
            ),
            new SkillEffectVampRuleRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectVampType.OMNIVAMP,
                SkillEffectVampBasisOutputKind.ACTUAL_HP_LOSS,
                "omnivamp_efficiency"
            )
        ));

        SkillEffectDamageDetail requestDetail = new SkillEffectDamageDetail(
            "physical",
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.DIRECT,
            new SkillEffectCriticalPolicy(SkillEffectCriticalMode.SOURCE_CRIT_CHANCE, "crit_multiplier"),
            List.of(
                new SkillEffectVampRule(
                    SkillEffectVampType.LIFE_STEAL,
                    SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE,
                    "life_steal_efficiency"
                ),
                new SkillEffectVampRule(
                    SkillEffectVampType.OMNIVAMP,
                    SkillEffectVampBasisOutputKind.ACTUAL_HP_LOSS,
                    "omnivamp_efficiency"
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
        assertEquals("crit_multiplier", saved.critical().multiplierFormulaKey());
        assertEquals(2, saved.vampRules().size());
        assertEquals(SkillEffectVampType.LIFE_STEAL, saved.vampRules().get(0).vampType());
        assertEquals(SkillEffectVampType.OMNIVAMP, saved.vampRules().get(1).vampType());
        verify(mapper).insertCriticalPolicy(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
            SkillEffectCriticalMode.SOURCE_CRIT_CHANCE, "crit_multiplier"
        );
        verify(mapper).insertVampRule(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
            SkillEffectVampType.LIFE_STEAL,
            SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE,
            "life_steal_efficiency"
        );
    }

    @Test
    void rejectsInvalidCriticalShapeAndDuplicateVampTypeBeforeWrite() {
        stubParentAndNewKey();
        SkillEffectDamageDetail invalid = new SkillEffectDamageDetail(
            "physical",
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.DIRECT,
            new SkillEffectCriticalPolicy(SkillEffectCriticalMode.DISALLOWED, "crit_multiplier"),
            List.of(
                new SkillEffectVampRule(
                    SkillEffectVampType.LIFE_STEAL,
                    SkillEffectVampBasisOutputKind.POST_DEFENSE_DAMAGE,
                    "life_steal_efficiency"
                ),
                new SkillEffectVampRule(
                    SkillEffectVampType.LIFE_STEAL,
                    SkillEffectVampBasisOutputKind.ACTUAL_HP_LOSS,
                    "other_efficiency"
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
        assertField(exception, "results[0].detail.critical.multiplierFormulaKey", "INVALID_CRITICAL_SHAPE");
        assertField(exception, "results[0].detail.vampRules[1].vampType", "DUPLICATE_VAMP_TYPE");
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any());
    }

    @Test
    void updateAppliesFullDiffKeepInsertDeleteAndCooldownValueToggle() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE),
            resultRow("direct_heal", SkillEffectResultType.DIRECT_HEAL),
            resultRow("reduce_self", SkillEffectResultType.COOLDOWN_CHANGE)
        ));
        when(mapper.listValues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(valueRow("physical_hit"), valueRow("direct_heal"), valueRow("reduce_self")),
            List.of(valueRow("physical_hit"))
        );
        when(mapper.listDamageDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(new SkillEffectDamageDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
            ))
        );
        when(mapper.listCriticalPolicies(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(new SkillEffectCriticalPolicyRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectCriticalMode.DISALLOWED, null
            ))
        );
        when(mapper.listVampRules(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listNormalShieldInteractions(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listAttributeChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listResourceChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listCooldownChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SkillEffectCooldownChangeOperation.REDUCE
            )),
            List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SkillEffectCooldownChangeOperation.RESET
            ))
        );
        when(mapper.listCooldownChangeTargets(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(new SkillEffectCooldownChangeTargetRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SKILL_KEY
            )),
            List.of(new SkillEffectCooldownChangeTargetRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SKILL_KEY
            ))
        );
        when(mapper.listStatusOperationDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(),
            List.of(new SkillEffectStatusOperationDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "apply_poison", "poison",
                SkillEffectStatusOperation.APPLY
            ))
        );
        stubEnabledCatalogs();
        when(mapper.deleteResults(eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), anyCollection())).thenReturn(1);
        when(mapper.updateResult(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateValue(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.deleteValue(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self")).thenReturn(1);
        when(mapper.updateDamageDetail(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateCriticalPolicy(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateCooldownChangeDetail(any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertResult(any(), any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertStatusOperationDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateEffect(GAME_ID, SKILL_KEY, EFFECT_KEY, "命中结果", null, 10)).thenReturn(1);
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResults(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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

        verify(mapper).deleteResults(eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq(List.of("direct_heal")));
        verify(mapper).deleteValue(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self");
        verify(mapper).insertResult(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("apply_poison"),
            any(), eq(SkillEffectResultType.STATUS_OPERATION), any(), any(), any()
        );
        verify(mapper, never()).insertValue(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("reduce_self"),
            any(), any(), any(), any()
        );
        verify(mapper).updateEffect(GAME_ID, SKILL_KEY, EFFECT_KEY, "命中结果", null, 10);
    }

    @Test
    void createFailsClosedWhenInsertThrows() {
        stubParentAndNewKey();
        stubEnabledCatalogs();
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertResult(any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenThrow(new DataIntegrityViolationException("insert failed"));

        assertThrows(
            DataIntegrityViolationException.class,
            () -> service.create(GAME_ID, SKILL_KEY, createDamageOnly())
        );
        verify(mapper).insertEffect(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), any(), any(), any()
        );
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

        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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
        verify(mapper, never()).deleteResults(any(), any(), any(), any());
        verify(mapper, never()).updateEffect(any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsInvalidValueRules() {
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
                            FORMULA_KEY, new BigDecimal("-1"), null, null
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
                            FORMULA_KEY, BigDecimal.ONE, new BigDecimal("10"), new BigDecimal("1")
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
                        new SkillEffectValueRuleRequest(FORMULA_KEY, BigDecimal.ONE, null, null),
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
            "results[0].valueRule.formulaKey".equals(issue.get("field"))
                && "UNKNOWN_FORMULA".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[0].detail.damageTypeKey".equals(issue.get("field"))
                && "UNKNOWN_DAMAGE_TYPE".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[1].valueRule.formulaKey".equals(issue.get("field"))
                && "UNKNOWN_FORMULA".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[1].detail.attributeKey".equals(issue.get("field"))
                && "UNKNOWN_ATTRIBUTE".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[2].valueRule.formulaKey".equals(issue.get("field"))
                && "UNKNOWN_FORMULA".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[2].detail.affectedSkillKeys[0]".equals(issue.get("field"))
                && "UNKNOWN_SKILL".equals(issue.get("code"))
        ));
        assertTrue(issues.stream().anyMatch(issue ->
            "results[3].detail.statusKey".equals(issue.get("field"))
                && "UNKNOWN_STATUS".equals(issue.get("code"))
        ));
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any());
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
        assertField(exception, "results[0].valueRule.formulaKey", "UNKNOWN_FORMULA");
        verify(mapper).lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection());
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any());
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
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any());

        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        when(mapper.listValues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(valueRow("physical_hit")));
        when(mapper.listDamageDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectDamageDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical")
        ));
        when(mapper.listAttributeChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listResourceChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listCooldownChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listStatusOperationDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.updateResult(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateValue(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateDamageDetail(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateEffect(any(), any(), any(), any(), any(), any())).thenReturn(1);
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
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertResult(any(), any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertValue(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertCooldownChangeDetail(any(), any(), any(), any(), any())).thenReturn(1);
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
            ((SkillEffectCooldownChangeDetail) created.results().get(0).detail()).affectedSkillKeys());

        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listValues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(),
            List.of(valueRow("reduce_self"))
        );
        when(mapper.listDamageDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listAttributeChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listResourceChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listCooldownChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(),
            List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SkillEffectCooldownChangeOperation.REDUCE
            ))
        );
        when(mapper.listStatusOperationDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.updateEffect(any(), any(), any(), any(), any(), any())).thenReturn(1);

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
            ((SkillEffectCooldownChangeDetail) updated.results().get(0).detail()).affectedSkillKeys());

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
        assertField(other, "results[0].detail.affectedSkillKeys[0]", "SKILL_DISABLED");
    }

    @Test
    void cooldownChangePersistsOneResultWithMultipleOrderedTargets() {
        stubParentAndNewKey();
        stubAllInserts();
        stubEnabledCatalogs();
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
        when(mapper.listCooldownChangeTargets(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectCooldownChangeTargetRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", "ezreal_w"),
            new SkillEffectCooldownChangeTargetRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", SKILL_KEY),
            new SkillEffectCooldownChangeTargetRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", "ezreal_r")
        ));

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
            List.of("ezreal_w", SKILL_KEY, "ezreal_r"),
            ((SkillEffectCooldownChangeDetail) created.results().get(0).detail()).affectedSkillKeys()
        );
        verify(mapper).insertCooldownChangeTarget(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", SKILL_KEY);
        verify(mapper).insertCooldownChangeTarget(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", "ezreal_w");
        verify(mapper).insertCooldownChangeTarget(GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", "ezreal_r");
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
        assertField(empty, "results[0].detail.affectedSkillKeys", "AFFECTED_SKILL_REQUIRED");

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
        assertField(duplicate, "results[0].detail.affectedSkillKeys[1]", "DUPLICATE_AFFECTED_SKILL");
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
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("reduce_abilities", SkillEffectResultType.COOLDOWN_CHANGE)
        ));
        when(mapper.listValues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(valueRow("reduce_abilities")));
        when(mapper.listDamageDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listAttributeChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listResourceChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listCooldownChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", SkillEffectCooldownChangeOperation.REDUCE
            )
        ));
        when(mapper.listCooldownChangeTargets(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectCooldownChangeTargetRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_abilities", "disabled_existing"
            )
        ));
        when(mapper.listStatusOperationDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
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
        assertField(exception, "results[0].detail.affectedSkillKeys[1]", "SKILL_DISABLED");
    }

    @Test
    void deleteEffectDoesNotTouchCatalogs() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.deleteEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1);

        service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY);

        verify(mapper).deleteEffect(GAME_ID, SKILL_KEY, EFFECT_KEY);
        verify(mapper, never()).deleteResults(any(), any(), any(), any());
        verify(skillMapper, never()).delete(any(), any());
    }

    @Test
    void deleteEffectProtectsProcessBindingsWithStableConflict() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);

        assertCode("409.SKILL_EFFECT_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
        verify(mapper, never()).deleteEffect(any(), any(), any());

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
        stubAllInserts();
        stubEnabledCatalogs();
        stubDetailRead(sixNonShieldResultRows(), sixNonShieldValueRows(), sixNonShieldDetails());

        SkillEffectDetailResponse detail = service.create(GAME_ID, SKILL_KEY, createSixNonShieldResults());
        assertNull(detail.lifecycle());
        assertNull(detail.results().get(0).lifecycleBehavior());
        verify(mapper, never()).insertLifecycle(
            any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
        verify(mapper, never()).insertLifecycleBehavior(
            any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void createsFullLifecycleAndReadsItBackWithApplicationBehavior() {
        stubParentAndNewKey();
        stubAllInserts();
        stubEnabledCatalogs();
        when(mapper.insertLifecycle(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        when(mapper.insertLifecycleBehavior(any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        stubDetailRead(List.of(resultRow("physical_hit", SkillEffectResultType.DAMAGE)),
            List.of(valueRow("physical_hit")),
            new DetailBundle(
                List.of(new SkillEffectDamageDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
                )),
                List.of(), List.of(), List.of(), List.of()
            ));
        when(mapper.findLifecycle(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());
        when(mapper.listLifecycleBehaviors(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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
        assertEquals(DURATION_FORMULA, detail.lifecycle().durationFormulaKey());
        assertEquals(SkillEffectLifecycleMoment.APPLICATION, detail.results().get(0).lifecycleBehavior().moment());
        verify(mapper).insertLifecycle(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY),
            eq(DURATION_FORMULA), eq(MAX_STACKS_FORMULA), eq(APP_STACKS_FORMULA),
            eq(SkillEffectLifecycleInstanceScope.TARGET),
            eq(SkillEffectLifecycleReapplicationStackMode.INCREASE),
            eq(SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL),
            eq(SkillEffectLifecycleExpiryMode.ALL_AT_ONCE),
            isNull(), isNull()
        );
        verify(mapper).insertLifecycleBehavior(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY), eq("physical_hit"),
            eq(SkillEffectLifecycleMoment.APPLICATION),
            eq(SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT),
            isNull(), isNull(), isNull()
        );
        verify(mapper, never()).deleteLifecycle(any(), any(), any());
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
        assertField(missingPeriodic, "lifecycle.periodicIntervalFormulaKey", "REQUIRED");

        ApiException extraPeriodic = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10,
                    new SkillEffectLifecycleRequest(
                        DURATION_FORMULA, MAX_STACKS_FORMULA, APP_STACKS_FORMULA,
                        SkillEffectLifecycleInstanceScope.TARGET,
                        SkillEffectLifecycleReapplicationStackMode.INCREASE,
                        SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL,
                        SkillEffectLifecycleExpiryMode.ALL_AT_ONCE,
                        PERIODIC_FORMULA,
                        SkillEffectLifecycleFirstPeriodicExecution.IMMEDIATE
                    ),
                    List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", extraPeriodic.getCode());
        assertField(extraPeriodic, "lifecycle.periodicIntervalFormulaKey", "FORBIDDEN");

        ApiException naturalEnd = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillEffectCreateRequest(
                    EFFECT_KEY, "命中结果", null, 10,
                    new SkillEffectLifecycleRequest(
                        null, MAX_STACKS_FORMULA, APP_STACKS_FORMULA,
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
            MAX_STACKS_FORMULA,
            APP_STACKS_FORMULA,
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
        assertField(linearWithoutDuration, "lifecycle.durationFormulaKey", "REQUIRED");

        stubParentAndNewKey();
        stubAllInserts();
        stubEnabledCatalogs();
        when(mapper.insertLifecycle(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        when(mapper.insertLifecycleBehavior(any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        stubDetailRead(
            List.of(resultRow("normal_shield", SkillEffectResultType.NORMAL_SHIELD)),
            List.of(valueRow("normal_shield")),
            new DetailBundle(List.of(), List.of(), List.of(), List.of(), List.of())
        );
        when(mapper.listNormalShieldInteractions(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectNormalShieldInteractionRow(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                "normal_shield",
                "physical",
                SkillEffectNormalShieldDecayMode.LINEAR_TO_ZERO
            )
        ));
        when(mapper.findLifecycle(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());
        when(mapper.listLifecycleBehaviors(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
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
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any());
    }

    @Test
    void deletePrefersProcessBindingOverLifecycleReference() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(2L);
        when(mapper.countLifecycleOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(3L);

        assertCode("409.SKILL_EFFECT_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
        verify(mapper, never()).deleteEffect(any(), any(), any());
    }

    @Test
    void deleteLifecycleInUseWhenOnlyOperationReferencesExist() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.countProcessBindings(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.countLifecycleOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);

        assertCode("409.SKILL_EFFECT_LIFECYCLE_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, EFFECT_KEY));
        verify(mapper, never()).deleteEffect(any(), any(), any());
    }

    @Test
    void removingLifecycleIsRejectedWhenReferencedAndClearingDurationIsRejectedWhenRefreshInUse() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        when(mapper.findLifecycleForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());
        when(mapper.countLifecycleOperationReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);
        stubEnabledCatalogs();

        assertCode(
            "409.SKILL_EFFECT_LIFECYCLE_IN_USE",
            () -> service.update(
                GAME_ID, SKILL_KEY, EFFECT_KEY,
                new SkillEffectUpdateRequest(null, "命中结果", null, 10, List.of(damageResult("physical_hit")))
            )
        );
        verify(mapper, never()).deleteLifecycle(any(), any(), any());
        verify(mapper, never()).updateLifecycle(
            any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
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
                        null, MAX_STACKS_FORMULA, APP_STACKS_FORMULA,
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
        assertField(refresh, "lifecycle.durationFormulaKey", "REFRESH_OPERATION_IN_USE");
        verify(mapper, never()).updateLifecycle(
            any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void updateExistingLifecycleUsesInPlaceUpdate() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        when(mapper.findLifecycleForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());
        when(mapper.listValues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(valueRow("physical_hit")));
        when(mapper.listDamageDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectDamageDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical")
        ));
        when(mapper.listLifecycleBehaviors(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                null, null, null
            )
        ));
        stubEnabledCatalogs();
        when(mapper.updateLifecycle(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        when(mapper.updateResult(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateValue(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateDamageDetail(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateLifecycleBehavior(any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        when(mapper.updateEffect(GAME_ID, SKILL_KEY, EFFECT_KEY, "命中结果", null, 10)).thenReturn(1);
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
        when(mapper.findLifecycle(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());

        service.update(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            new SkillEffectUpdateRequest(
                null, "命中结果", null, 10, timedLifecycle(),
                List.of(damageResultWithBehavior("physical_hit", applicationSnapshot()))
            )
        );
        verify(mapper).updateLifecycle(
            eq(GAME_ID), eq(SKILL_KEY), eq(EFFECT_KEY),
            eq(DURATION_FORMULA), eq(MAX_STACKS_FORMULA), eq(APP_STACKS_FORMULA),
            eq(SkillEffectLifecycleInstanceScope.TARGET),
            eq(SkillEffectLifecycleReapplicationStackMode.INCREASE),
            eq(SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL),
            eq(SkillEffectLifecycleExpiryMode.ALL_AT_ONCE),
            isNull(), isNull()
        );
        verify(mapper, never()).deleteLifecycle(any(), any(), any());
        verify(mapper, never()).insertLifecycle(
            any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
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
        assertField(exception, "lifecycle.durationFormulaKey", "UNKNOWN_LIFECYCLE_FORMULA");
        assertField(exception, "lifecycle.maxStacksFormulaKey", "UNKNOWN_LIFECYCLE_FORMULA");
        assertField(exception, "results[0].valueRule.formulaKey", "UNKNOWN_FORMULA");
        verify(mapper, never()).insertEffect(any(), any(), any(), any(), any(), any());
    }

    @Test
    void instanceScopeIsImmutableOnExistingLifecycle() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        when(mapper.findLifecycleForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                EFFECT_KEY,
                new SkillEffectUpdateRequest(
                    null, "命中结果", null, 10,
                    new SkillEffectLifecycleRequest(
                        DURATION_FORMULA, MAX_STACKS_FORMULA, APP_STACKS_FORMULA,
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
        verify(mapper, never()).updateLifecycle(
            any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
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
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any())).thenThrow(unrelated);
        DataIntegrityViolationException thrown = assertThrows(
            DataIntegrityViolationException.class,
            () -> service.create(GAME_ID, SKILL_KEY, createDamageOnly())
        );
        assertEquals(unrelated, thrown);
    }

    @Test
    void assembleReturnsInternalErrorWhenShapeIsCorrupt() {
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResults(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        when(mapper.listValues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listDamageDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listAttributeChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listResourceChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listCooldownChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listStatusOperationDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());

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
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any()))
            .thenThrow(new DataIntegrityViolationException("violates pk_skill_effects"));

        assertCode("409.SKILL_EFFECT_KEY_EXISTS", () -> service.create(GAME_ID, SKILL_KEY, createDamageOnly()));
    }

    @Test
    void triggerRuleProtectsEffectDeleteUpdateAndCycleWithLongConstructor() {
        xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService triggerRuleService =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService.class);
        SkillEffectService guarded = new SkillEffectService(gamesMapper, skillMapper, mapper, triggerRuleService);
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.findEffectForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
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
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        when(mapper.findLifecycleForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());
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
        when(mapper.listResultsForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE)
        ));
        when(mapper.findLifecycleForUpdate(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(lifecycleRow());
        when(mapper.listValues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(valueRow("physical_hit")));
        when(mapper.listDamageDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectDamageDetailRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical")
        ));
        when(mapper.listLifecycleBehaviors(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            new SkillEffectResultLifecycleBehaviorRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit",
                SkillEffectLifecycleMoment.APPLICATION,
                SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                null, null, null
            )
        ));
        stubEnabledCatalogs();
        when(mapper.updateLifecycle(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        when(mapper.updateResult(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateValue(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateDamageDetail(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateLifecycleBehavior(any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        when(mapper.updateEffect(GAME_ID, SKILL_KEY, EFFECT_KEY, "命中结果", null, 10)).thenReturn(1);
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

    private void stubParentAndNewKey() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
    }

    private void stubAllInserts() {
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertResult(any(), any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertValue(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertDamageDetail(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertCriticalPolicy(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertVampRule(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertNormalShieldInteraction(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertDamageModifierDetail(
            any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        )).thenReturn(1);
        when(mapper.insertHealingModifierDetail(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertDamageImmunityDetail(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertHealthFloorDetail(any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertExecuteDetail(any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertAttributeChangeDetail(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertResourceChangeDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertCooldownChangeDetail(any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertCooldownChangeTarget(any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertStatusOperationDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertLifecycle(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
        when(mapper.insertLifecycleBehavior(any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(1);
    }

    @SuppressWarnings("unchecked")
    private void stubEnabledCatalogs() {
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> new ArrayList<>((Collection<String>) invocation.getArgument(2)));
        when(mapper.lockDamageTypes(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockAttributes(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockSkills(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockStatuses(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockModifierZones(eq(GAME_ID), anyCollection())).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Collection<String> keys = (Collection<String>) invocation.getArgument(1);
            List<SkillEffectModifierZoneLockRow> rows = new ArrayList<>();
            for (String key : keys) {
                ModifierZoneDomain domain = HEALING_ZONE_KEY.equals(key)
                    ? ModifierZoneDomain.HEALING
                    : ModifierZoneDomain.DAMAGE;
                rows.add(new SkillEffectModifierZoneLockRow(key, domain, ModifierZoneStatus.ENABLED));
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
        when(mapper.findEffect(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(effectRow());
        when(mapper.listResults(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(results);
        when(mapper.listValues(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(values);
        when(mapper.listDamageDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.damage);
        when(mapper.listCriticalPolicies(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            results.stream()
                .filter(row -> row.resultType() == SkillEffectResultType.DAMAGE)
                .map(row -> new SkillEffectCriticalPolicyRow(
                    row.gameId(), row.skillKey(), row.effectKey(), row.resultKey(),
                    SkillEffectCriticalMode.DISALLOWED, null
                ))
                .toList()
        );
        when(mapper.listVampRules(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listNormalShieldInteractions(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            results.stream()
                .filter(row -> row.resultType() == SkillEffectResultType.NORMAL_SHIELD)
                .map(row -> new SkillEffectNormalShieldInteractionRow(
                    row.gameId(), row.skillKey(), row.effectKey(), row.resultKey(),
                    null, SkillEffectNormalShieldDecayMode.NONE
                ))
                .toList()
        );
        when(mapper.listAttributeChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.attributes);
        when(mapper.listResourceChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.resources);
        when(mapper.listCooldownChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.cooldowns);
        when(mapper.listCooldownChangeTargets(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            details.cooldowns.stream()
                .map(row -> new SkillEffectCooldownChangeTargetRow(
                    row.gameId(), row.skillKey(), row.effectKey(), row.resultKey(), SKILL_KEY
                ))
                .toList()
        );
        when(mapper.listStatusOperationDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.statuses);
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
            new SkillEffectCooldownChangeDetail(affectedSkillKeys, SkillEffectCooldownChangeOperation.REDUCE)
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
            new SkillEffectCooldownChangeDetail(List.of(affectedSkillKey), SkillEffectCooldownChangeOperation.RESET)
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
        return new SkillEffectValueRuleRequest(FORMULA_KEY, BigDecimal.ONE, null, null);
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
            GAME_ID, SKILL_KEY, EFFECT_KEY, resultKey, FORMULA_KEY, BigDecimal.ONE, null, null
        );
    }

    private static SkillEffectRow effectRow() {
        return new SkillEffectRow(GAME_ID, SKILL_KEY, EFFECT_KEY, "命中结果", null, 10, TS, TS);
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
            DURATION_FORMULA,
            MAX_STACKS_FORMULA,
            APP_STACKS_FORMULA,
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
        return new SkillEffectResultRequest(
            resultKey,
            "施加中毒",
            SkillEffectResultType.STATUS_OPERATION,
            SkillEffectTarget.TARGET,
            null,
            6,
            null,
            new SkillEffectStatusOperationDetail("poison", SkillEffectStatusOperation.APPLY),
            behavior
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
        return new SkillEffectLifecycleRow(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            DURATION_FORMULA,
            MAX_STACKS_FORMULA,
            APP_STACKS_FORMULA,
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.INCREASE,
            SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL,
            SkillEffectLifecycleExpiryMode.ALL_AT_ONCE,
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
            MAX_STACKS_FORMULA,
            APP_STACKS_FORMULA,
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.KEEP,
            null,
            SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY,
            null,
            null
        );
    }

    private record DetailBundle(
        List<SkillEffectDamageDetailRow> damage,
        List<SkillEffectAttributeChangeDetailRow> attributes,
        List<SkillEffectResourceChangeDetailRow> resources,
        List<SkillEffectCooldownChangeDetailRow> cooldowns,
        List<SkillEffectStatusOperationDetailRow> statuses
    ) {
    }
}
