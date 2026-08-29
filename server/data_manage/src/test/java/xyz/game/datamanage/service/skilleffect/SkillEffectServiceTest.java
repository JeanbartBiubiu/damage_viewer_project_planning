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
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectDirectHealDetail;
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
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillEffectServiceTest {

    private static final String GAME_ID = "lol";
    private static final String SKILL_KEY = "ezreal_q";
    private static final String EFFECT_KEY = "on_hit_results";
    private static final String TARGET_EFFECT_KEY = "mark_effect";
    private static final String FORMULA_KEY = "base_damage";
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
    void createsAllSevenResultKindsAndReadsThemBack() {
        stubParentAndNewKey();
        stubAllInserts();
        stubEnabledCatalogs();
        stubDetailRead(sevenResultRows(), sevenValueRows(), sevenDetails());

        SkillEffectDetailResponse detail = service.create(GAME_ID, SKILL_KEY, createAllSeven());
        assertEquals(EFFECT_KEY, detail.effectKey());
        assertEquals(7, detail.results().size());
        assertEquals(SkillEffectResultType.DAMAGE, detail.results().get(0).resultType());
        assertInstanceOf(SkillEffectDamageDetail.class, detail.results().get(0).detail());
        assertEquals(SkillEffectResultType.DIRECT_HEAL, detail.results().get(1).resultType());
        assertInstanceOf(SkillEffectDirectHealDetail.class, detail.results().get(1).detail());
        assertEquals(SkillEffectResultType.NORMAL_SHIELD, detail.results().get(2).resultType());
        assertInstanceOf(SkillEffectNormalShieldDetail.class, detail.results().get(2).detail());
        assertEquals(SkillEffectResultType.ATTRIBUTE_CHANGE, detail.results().get(3).resultType());
        assertEquals(SkillEffectResultType.RESOURCE_CHANGE, detail.results().get(4).resultType());
        assertEquals(SkillEffectResultType.COOLDOWN_CHANGE, detail.results().get(5).resultType());
        assertEquals(FORMULA_KEY, detail.results().get(5).valueRule().formulaKey());
        assertEquals(SkillEffectResultType.STATUS_OPERATION, detail.results().get(6).resultType());
        assertNull(detail.results().get(6).valueRule());

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
        verify(mapper).insertDamageDetail(GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical");
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
        when(mapper.listAttributeChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listResourceChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listCooldownChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(
            List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SKILL_KEY,
                SkillEffectCooldownChangeOperation.REDUCE
            )),
            List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SKILL_KEY,
                SkillEffectCooldownChangeOperation.RESET
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
        when(mapper.updateDamageDetail(any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.updateCooldownChangeDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
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
            "results[2].detail.affectedSkillKey".equals(issue.get("field"))
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
        when(mapper.updateDamageDetail(any(), any(), any(), any(), any())).thenReturn(1);
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
        when(mapper.insertCooldownChangeDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
        stubDetailRead(
            List.of(resultRow("reduce_self", SkillEffectResultType.COOLDOWN_CHANGE)),
            List.of(valueRow("reduce_self")),
            new DetailBundle(
                List.of(),
                List.of(),
                List.of(),
                List.of(new SkillEffectCooldownChangeDetailRow(
                    GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SKILL_KEY,
                    SkillEffectCooldownChangeOperation.REDUCE
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
        assertEquals(SKILL_KEY,
            ((SkillEffectCooldownChangeDetail) created.results().get(0).detail()).affectedSkillKey());

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
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reduce_self", SKILL_KEY,
                SkillEffectCooldownChangeOperation.REDUCE
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
        assertEquals(SKILL_KEY,
            ((SkillEffectCooldownChangeDetail) updated.results().get(0).detail()).affectedSkillKey());

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
        assertField(other, "results[0].detail.affectedSkillKey", "SKILL_DISABLED");
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
        stubDetailRead(sevenResultRows(), sevenValueRows(), sevenDetails());

        SkillEffectDetailResponse detail = service.create(GAME_ID, SKILL_KEY, createAllSeven());
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
                    new SkillEffectResultLifecycleBehaviorRequest(
                        SkillEffectLifecycleMoment.PERSISTENT,
                        SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT,
                        SkillEffectLifecycleStackValueMode.SHARED,
                        SkillEffectLifecycleReapplicationValueMode.KEEP,
                        null
                    )
                ))
            )
        );
        assertEquals(SkillEffectLifecycleMoment.PERSISTENT, detail.results().get(0).lifecycleBehavior().moment());
        assertEquals(
            SkillEffectLifecycleStackValueMode.SHARED,
            detail.results().get(0).lifecycleBehavior().stackValueMode()
        );
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
        when(mapper.updateDamageDetail(any(), any(), any(), any(), any())).thenReturn(1);
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

    private void stubParentAndNewKey() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
    }

    private void stubAllInserts() {
        when(mapper.insertEffect(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertResult(any(), any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertValue(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertDamageDetail(any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertAttributeChangeDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertResourceChangeDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertCooldownChangeDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertStatusOperationDetail(any(), any(), any(), any(), any(), any())).thenReturn(1);
    }

    @SuppressWarnings("unchecked")
    private void stubEnabledCatalogs() {
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> new ArrayList<>((Collection<String>) invocation.getArgument(2)));
        when(mapper.lockDamageTypes(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockAttributes(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockSkills(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
        when(mapper.lockStatuses(eq(GAME_ID), anyCollection())).thenAnswer(this::enabledLocks);
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
        when(mapper.listAttributeChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.attributes);
        when(mapper.listResourceChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.resources);
        when(mapper.listCooldownChangeDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.cooldowns);
        when(mapper.listStatusOperationDetails(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(details.statuses);
    }

    private static SkillEffectCreateRequest createAllSeven() {
        return new SkillEffectCreateRequest(
            EFFECT_KEY,
            "命中结果",
            null,
            10,
            List.of(
                damageResult("physical_hit"),
                healResult("direct_heal"),
                shieldResult("normal_shield"),
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
        return new SkillEffectResultRequest(
            resultKey,
            "减少冷却",
            SkillEffectResultType.COOLDOWN_CHANGE,
            SkillEffectTarget.SOURCE,
            null,
            5,
            valueRule(),
            new SkillEffectCooldownChangeDetail(affectedSkillKey, SkillEffectCooldownChangeOperation.REDUCE)
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
            new SkillEffectCooldownChangeDetail(affectedSkillKey, SkillEffectCooldownChangeOperation.RESET)
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

    private static SkillEffectValueRuleRequest valueRule() {
        return new SkillEffectValueRuleRequest(FORMULA_KEY, BigDecimal.ONE, null, null);
    }

    private static List<SkillEffectResultRow> sevenResultRows() {
        return List.of(
            resultRow("physical_hit", SkillEffectResultType.DAMAGE),
            resultRow("direct_heal", SkillEffectResultType.DIRECT_HEAL),
            resultRow("normal_shield", SkillEffectResultType.NORMAL_SHIELD),
            resultRow("buff_ad", SkillEffectResultType.ATTRIBUTE_CHANGE),
            resultRow("consume_mp", SkillEffectResultType.RESOURCE_CHANGE),
            resultRow("reset_self", SkillEffectResultType.COOLDOWN_CHANGE),
            resultRow("apply_poison", SkillEffectResultType.STATUS_OPERATION)
        );
    }

    private static List<SkillEffectResultValueRow> sevenValueRows() {
        return List.of(
            valueRow("physical_hit"),
            valueRow("direct_heal"),
            valueRow("normal_shield"),
            valueRow("buff_ad"),
            valueRow("consume_mp"),
            valueRow("reset_self")
        );
    }

    private static DetailBundle sevenDetails() {
        return new DetailBundle(
            List.of(new SkillEffectDamageDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "physical_hit", "physical"
            )),
            List.of(new SkillEffectAttributeChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "buff_ad", "ad",
                SkillEffectAttributeChangeOperation.INCREASE
            )),
            List.of(new SkillEffectResourceChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "consume_mp", "mp",
                SkillEffectResourceChangeOperation.CONSUME
            )),
            List.of(new SkillEffectCooldownChangeDetailRow(
                GAME_ID, SKILL_KEY, EFFECT_KEY, "reset_self", SKILL_KEY,
                SkillEffectCooldownChangeOperation.REDUCE
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
        return new SkillEffectResultRequest(
            resultKey,
            "普通护盾",
            SkillEffectResultType.NORMAL_SHIELD,
            SkillEffectTarget.SOURCE,
            null,
            2,
            valueRule(),
            new SkillEffectNormalShieldDetail(),
            behavior
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
