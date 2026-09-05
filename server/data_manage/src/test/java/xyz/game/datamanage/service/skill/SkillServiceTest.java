package xyz.game.datamanage.service.skill;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper;
import xyz.game.datamanage.mapper.skillinternalstate.SkillInternalStateMapper;
import xyz.game.datamanage.mapper.skillparameter.SkillParameterMapper;
import xyz.game.datamanage.mapper.skillprocess.SkillProcessMapper;
import xyz.game.datamanage.model.skill.SkillCategoryLockRow;
import xyz.game.datamanage.model.skill.SkillCategoryRelationRow;
import xyz.game.datamanage.model.skill.SkillCreateRequest;
import xyz.game.datamanage.model.skill.SkillListQuery;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skill.SkillUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterRow;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.service.skillparameter.SkillParameterLevelService;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class SkillServiceTest {

    private static final String GAME_ID = "lol";
    private static final String SKILL_KEY = "ezreal_q";

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper mapper;
    @Mock private SkillParameterMapper parameterMapper;
    @Mock private SkillFormulaMapper formulaMapper;
    @Mock private SkillEffectMapper effectMapper;
    @Mock private SkillProcessMapper processMapper;
    @Mock private SkillInternalStateMapper internalStateMapper;

    private SkillService service;

    @BeforeEach
    void setUp() {
        SkillParameterLevelService levelService = new SkillParameterLevelService(new ObjectMapper());
        service = new SkillService(
            gamesMapper,
            mapper,
            parameterMapper,
            formulaMapper,
            effectMapper,
            processMapper,
            internalStateMapper,
            levelService
        );
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listsMergesBatchedRelationsAndSkipsQueryWhenEmpty() {
        when(mapper.list(GAME_ID, null, null)).thenReturn(List.of());
        var empty = service.list(GAME_ID, new SkillListQuery("  ", null));
        assertEquals(0, empty.total());
        assertEquals(List.of(), empty.items());
        verify(mapper, never()).listRelations(anyString(), anyList());

        when(mapper.list(GAME_ID, "ezreal", "ENABLED")).thenReturn(List.of(row("ezreal_q", 10), row("ezreal_w", 20)));
        when(mapper.listRelations(GAME_ID, List.of("ezreal_q", "ezreal_w"))).thenReturn(List.of(
            new SkillCategoryRelationRow("ezreal_q", "active"),
            new SkillCategoryRelationRow("ezreal_q", "single_target"),
            new SkillCategoryRelationRow("ezreal_w", "active")
        ));

        var result = service.list(GAME_ID, new SkillListQuery(" ezreal ", " ENABLED "));
        assertEquals(2, result.total());
        assertEquals(List.of("active", "single_target"), result.items().get(0).skillCategoryKeys());
        assertEquals(List.of("active"), result.items().get(1).skillCategoryKeys());
        assertEquals("ezreal_w", result.items().get(1).skillKey());
    }

    @Test
    void rejectsInvalidListStatusBeforeMapperAccess() {
        assertCode("400.VALIDATION_FAILED", () -> service.list(GAME_ID, new SkillListQuery(null, "ARCHIVED")));
        verify(mapper, never()).list(anyString(), any(), any());
    }

    @Test
    void createsWithEmptyAndMultipleCategories() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY)).thenReturn(0L);
        when(mapper.insert(GAME_ID, SKILL_KEY, "秘术射击", null, 5, "ENABLED", 10)).thenReturn(1);
        when(mapper.findById(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(mapper.listRelations(GAME_ID, List.of(SKILL_KEY))).thenReturn(List.of());

        SkillResponse emptyCreated = service.create(GAME_ID, createRequest(List.of()));
        assertEquals(List.of(), emptyCreated.skillCategoryKeys());
        verify(mapper, never()).lockCategories(anyString(), anyList());
        verify(mapper, never()).insertRelation(anyString(), anyString(), anyString());

        when(mapper.lockCategories(GAME_ID, List.of("active", "single_target"))).thenReturn(List.of(
            new SkillCategoryLockRow("active", "ENABLED"),
            new SkillCategoryLockRow("single_target", "ENABLED")
        ));
        when(mapper.insertRelation(GAME_ID, SKILL_KEY, "active")).thenReturn(1);
        when(mapper.insertRelation(GAME_ID, SKILL_KEY, "single_target")).thenReturn(1);
        when(mapper.listRelations(GAME_ID, List.of(SKILL_KEY))).thenReturn(List.of(
            new SkillCategoryRelationRow(SKILL_KEY, "active"),
            new SkillCategoryRelationRow(SKILL_KEY, "single_target")
        ));

        SkillResponse created = service.create(
            GAME_ID,
            new SkillCreateRequest(" ezreal_q ", " 秘术射击 ", " ", 5, SkillStatus.ENABLED, 10, List.of("single_target", "active"))
        );
        assertEquals(List.of("active", "single_target"), created.skillCategoryKeys());
        verify(mapper).lockCategories(GAME_ID, List.of("active", "single_target"));
        verify(mapper).insertRelation(GAME_ID, SKILL_KEY, "single_target");
        verify(mapper).insertRelation(GAME_ID, SKILL_KEY, "active");
    }

    @Test
    void duplicateNamesAreAllowedAndDuplicateCategoryInputIsRejected() {
        when(mapper.countByKey(GAME_ID, "ezreal_w")).thenReturn(0L);
        when(mapper.insert(GAME_ID, "ezreal_w", "秘术射击", null, 5, "ENABLED", 11)).thenReturn(1);
        when(mapper.findById(GAME_ID, "ezreal_w")).thenReturn(row("ezreal_w", 11));
        when(mapper.listRelations(GAME_ID, List.of("ezreal_w"))).thenReturn(List.of());

        assertEquals("ezreal_w", service.create(GAME_ID, createRequest("ezreal_w", List.of())).skillKey());

        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.create(GAME_ID, createRequest(List.of("active", "active")))
        );
        ApiException duplicate = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, createRequest(List.of("active", "active")))
        );
        assertEquals("/skillCategoryKeys/1", firstField(duplicate));
        verify(mapper, never()).lockCategories(anyString(), anyList());
        verify(mapper, never()).insert(eq(GAME_ID), eq(SKILL_KEY), any(), any(), any(), any(), any());
    }

    @Test
    void reportsUnknownCategoryBeforeDisabledAndKeepsOriginalIndex() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY)).thenReturn(0L);
        when(mapper.lockCategories(GAME_ID, List.of("disabled_cat", "missing"))).thenReturn(List.of(
            new SkillCategoryLockRow("disabled_cat", "DISABLED")
        ));

        ApiException unknownFirst = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, createRequest(List.of("missing", "disabled_cat")))
        );
        assertEquals("400.UNKNOWN_SKILL_CATEGORY", unknownFirst.getCode());
        assertEquals("/skillCategoryKeys/0", firstField(unknownFirst));

        ApiException unknownSecond = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, createRequest(List.of("disabled_cat", "missing")))
        );
        assertEquals("400.UNKNOWN_SKILL_CATEGORY", unknownSecond.getCode());
        assertEquals("/skillCategoryKeys/1", firstField(unknownSecond));
        verify(mapper, never()).insert(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsNewlyDisabledCategoryOnCreate() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY)).thenReturn(0L);
        when(mapper.lockCategories(GAME_ID, List.of("disabled_cat"))).thenReturn(List.of(
            new SkillCategoryLockRow("disabled_cat", "DISABLED")
        ));

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, createRequest(List.of("disabled_cat")))
        );
        assertEquals("409.SKILL_CATEGORY_DISABLED", ex.getCode());
        assertEquals("/skillCategoryKeys/0", firstField(ex));
        verify(mapper, never()).insert(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void preservesOrRemovesExistingDisabledCategoryAndRejectsNewlyAddedDisabled() {
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(mapper.listRelationKeys(GAME_ID, SKILL_KEY)).thenReturn(List.of("active", "disabled_cat"));
        when(mapper.lockCategories(GAME_ID, List.of("active", "disabled_cat"))).thenReturn(List.of(
            new SkillCategoryLockRow("active", "ENABLED"),
            new SkillCategoryLockRow("disabled_cat", "DISABLED")
        ));
        when(mapper.update(GAME_ID, SKILL_KEY, "秘术射击", null, 5, "ENABLED", 10)).thenReturn(1);
        when(mapper.findById(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(mapper.listRelations(GAME_ID, List.of(SKILL_KEY))).thenReturn(List.of(
            new SkillCategoryRelationRow(SKILL_KEY, "active"),
            new SkillCategoryRelationRow(SKILL_KEY, "disabled_cat")
        ));

        SkillResponse preserved = service.update(
            GAME_ID,
            SKILL_KEY,
            updateRequest(List.of("active", "disabled_cat"))
        );
        assertEquals(List.of("active", "disabled_cat"), preserved.skillCategoryKeys());
        verify(mapper, never()).insertRelation(anyString(), anyString(), anyString());
        verify(mapper, never()).deleteRelations(anyString(), anyString(), anyList());

        when(mapper.lockCategories(GAME_ID, List.of("active"))).thenReturn(List.of(
            new SkillCategoryLockRow("active", "ENABLED")
        ));
        when(mapper.listRelations(GAME_ID, List.of(SKILL_KEY))).thenReturn(List.of(
            new SkillCategoryRelationRow(SKILL_KEY, "active")
        ));
        service.update(GAME_ID, SKILL_KEY, updateRequest(List.of("active")));
        verify(mapper).deleteRelations(GAME_ID, SKILL_KEY, List.of("disabled_cat"));

        when(mapper.lockCategories(GAME_ID, List.of("other_disabled"))).thenReturn(List.of(
            new SkillCategoryLockRow("other_disabled", "DISABLED")
        ));
        ApiException newlyDisabled = assertThrows(
            ApiException.class,
            () -> service.update(GAME_ID, SKILL_KEY, updateRequest(List.of("other_disabled")))
        );
        assertEquals("409.SKILL_CATEGORY_DISABLED", newlyDisabled.getCode());
        assertEquals("/skillCategoryKeys/0", firstField(newlyDisabled));
    }

    @Test
    void emptyArrayUpdateDeletesAllRelationsWithoutLocking() {
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(mapper.listRelationKeys(GAME_ID, SKILL_KEY)).thenReturn(List.of("active"));
        when(mapper.update(GAME_ID, SKILL_KEY, "秘术射击", null, 5, "ENABLED", 10)).thenReturn(1);
        when(mapper.deleteAllRelations(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(mapper.findById(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(mapper.listRelations(GAME_ID, List.of(SKILL_KEY))).thenReturn(List.of());

        SkillResponse updated = service.update(GAME_ID, SKILL_KEY, updateRequest(List.of()));
        assertEquals(List.of(), updated.skillCategoryKeys());
        verify(mapper, never()).lockCategories(anyString(), anyList());
        verify(mapper, never()).insertRelation(anyString(), anyString(), anyString());
        verify(mapper).deleteAllRelations(GAME_ID, SKILL_KEY);
    }

    @Test
    void statusUpdatePreservesRelationships() {
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(mapper.listRelationKeys(GAME_ID, SKILL_KEY)).thenReturn(List.of("active"));
        when(mapper.lockCategories(GAME_ID, List.of("active"))).thenReturn(List.of(
            new SkillCategoryLockRow("active", "ENABLED")
        ));
        when(mapper.update(GAME_ID, SKILL_KEY, "秘术射击", null, 5, "DISABLED", 10)).thenReturn(1);
        when(mapper.findById(GAME_ID, SKILL_KEY)).thenReturn(disabledRow());
        when(mapper.listRelations(GAME_ID, List.of(SKILL_KEY))).thenReturn(List.of(
            new SkillCategoryRelationRow(SKILL_KEY, "active")
        ));

        SkillResponse updated = service.update(
            GAME_ID,
            SKILL_KEY,
            new SkillUpdateRequest(null, "秘术射击", null, 5, SkillStatus.DISABLED, 10, List.of("active"))
        );
        assertEquals(SkillStatus.DISABLED, updated.status());
        assertEquals(List.of("active"), updated.skillCategoryKeys());
        verify(mapper, never()).insertRelation(anyString(), anyString(), anyString());
        verify(mapper, never()).deleteRelations(anyString(), anyString(), anyList());
        verify(mapper, never()).deleteAllRelations(anyString(), anyString());
    }

    @Test
    void relationInsertFailureIsNotMappedAndDuplicateKeyMapsToConflict() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY)).thenReturn(0L);
        when(mapper.lockCategories(GAME_ID, List.of("active"))).thenReturn(List.of(
            new SkillCategoryLockRow("active", "ENABLED")
        ));
        when(mapper.insert(GAME_ID, SKILL_KEY, "秘术射击", null, 5, "ENABLED", 10)).thenReturn(1);
        when(mapper.insertRelation(GAME_ID, SKILL_KEY, "active"))
            .thenThrow(new DataIntegrityViolationException("relation failed"));

        DataIntegrityViolationException failure = assertThrows(
            DataIntegrityViolationException.class,
            () -> service.create(GAME_ID, createRequest(List.of("active")))
        );
        assertEquals("relation failed", failure.getMessage());

        when(mapper.insert(GAME_ID, SKILL_KEY, "秘术射击", null, 5, "ENABLED", 10))
            .thenThrow(new DataIntegrityViolationException("duplicate key value violates pk_skills"));
        assertCode("409.SKILL_KEY_EXISTS", () -> service.create(GAME_ID, createRequest(List.of("active"))));
    }

    @Test
    void missingSkillAndExistingKeyAreStable() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY)).thenReturn(1L);
        assertCode("409.SKILL_KEY_EXISTS", () -> service.create(GAME_ID, createRequest(List.of())));

        when(mapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.SKILL_NOT_FOUND", () -> service.get(GAME_ID, "missing"));

        when(mapper.findByIdForUpdate(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.SKILL_NOT_FOUND", () -> service.update(GAME_ID, "missing", updateRequest(List.of())));
    }

    @Test
    void malformedCategoryEntriesKeepOriginalIndex() {
        ApiException blank = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, createRequest(List.of("active", " ")))
        );
        assertEquals("400.VALIDATION_FAILED", blank.getCode());
        assertEquals("/skillCategoryKeys/1", firstField(blank));
        verify(mapper, never()).lockCategories(anyString(), anyList());
    }

    @Test
    void maxLevelExpandFillsZeroShrinkDeletesAndUnchangedSkipsRewrite() throws Exception {
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(mapper.listRelationKeys(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        when(parameterMapper.lockSkillLevelParamsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            parameterRow(
                "base_damage",
                SkillParameterValueMode.SKILL_LEVEL,
                "{\"1\":20,\"2\":45,\"3\":70,\"4\":95,\"5\":120}"
            )
        ));
        when(parameterMapper.updateLevelValuesJson(eq(GAME_ID), eq(SKILL_KEY), eq("base_damage"), anyString()))
            .thenReturn(1);
        when(mapper.update(GAME_ID, SKILL_KEY, "秘术射击", null, 6, "ENABLED", 10)).thenReturn(1);
        when(mapper.findById(GAME_ID, SKILL_KEY)).thenReturn(new SkillRow(
            GAME_ID, SKILL_KEY, "秘术射击", null, 6, SkillStatus.ENABLED, 10,
            OffsetDateTime.parse("2026-08-26T08:00:00Z"),
            OffsetDateTime.parse("2026-08-26T08:00:00Z")
        ));
        when(mapper.listRelations(GAME_ID, List.of(SKILL_KEY))).thenReturn(List.of());

        service.update(
            GAME_ID,
            SKILL_KEY,
            new SkillUpdateRequest(null, "秘术射击", null, 6, SkillStatus.ENABLED, 10, List.of())
        );

        ArgumentCaptor<String> expanded = ArgumentCaptor.forClass(String.class);
        verify(parameterMapper).updateLevelValuesJson(
            eq(GAME_ID), eq(SKILL_KEY), eq("base_damage"), expanded.capture()
        );
        assertEquals("{\"1\":20,\"2\":45,\"3\":70,\"4\":95,\"5\":120,\"6\":0}", expanded.getValue());

        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(new SkillRow(
            GAME_ID, SKILL_KEY, "秘术射击", null, 6, SkillStatus.ENABLED, 10,
            OffsetDateTime.parse("2026-08-26T08:00:00Z"),
            OffsetDateTime.parse("2026-08-26T08:00:00Z")
        ));
        when(parameterMapper.lockSkillLevelParamsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            parameterRow(
                "base_damage",
                SkillParameterValueMode.SKILL_LEVEL,
                "{\"1\":20,\"2\":45,\"3\":70,\"4\":95,\"5\":120,\"6\":0}"
            )
        ));
        when(mapper.update(GAME_ID, SKILL_KEY, "秘术射击", null, 4, "ENABLED", 10)).thenReturn(1);
        when(mapper.findById(GAME_ID, SKILL_KEY)).thenReturn(new SkillRow(
            GAME_ID, SKILL_KEY, "秘术射击", null, 4, SkillStatus.ENABLED, 10,
            OffsetDateTime.parse("2026-08-26T08:00:00Z"),
            OffsetDateTime.parse("2026-08-26T08:00:00Z")
        ));

        service.update(
            GAME_ID,
            SKILL_KEY,
            new SkillUpdateRequest(null, "秘术射击", null, 4, SkillStatus.ENABLED, 10, List.of())
        );
        ArgumentCaptor<String> remapped = ArgumentCaptor.forClass(String.class);
        verify(parameterMapper, org.mockito.Mockito.times(2)).updateLevelValuesJson(
            eq(GAME_ID), eq(SKILL_KEY), eq("base_damage"), remapped.capture()
        );
        assertEquals("{\"1\":20,\"2\":45,\"3\":70,\"4\":95}", remapped.getAllValues().get(1));

        org.mockito.Mockito.clearInvocations(parameterMapper);
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(mapper.update(GAME_ID, SKILL_KEY, "秘术射击", null, 5, "ENABLED", 11)).thenReturn(1);
        when(mapper.findById(GAME_ID, SKILL_KEY)).thenReturn(new SkillRow(
            GAME_ID, SKILL_KEY, "秘术射击", null, 5, SkillStatus.ENABLED, 11,
            OffsetDateTime.parse("2026-08-26T08:00:00Z"),
            OffsetDateTime.parse("2026-08-26T08:00:00Z")
        ));
        service.update(
            GAME_ID,
            SKILL_KEY,
            new SkillUpdateRequest(null, "秘术射击", null, 5, SkillStatus.ENABLED, 11, List.of())
        );
        verify(parameterMapper, never()).lockSkillLevelParamsForSkill(GAME_ID, SKILL_KEY);
        verify(parameterMapper, never()).updateLevelValuesJson(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void deleteSkillRemovesFormulasThenParametersThenSkill() {
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(formulaMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(2);
        when(parameterMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(3);
        when(mapper.delete(GAME_ID, SKILL_KEY)).thenReturn(1);

        service.delete(GAME_ID, SKILL_KEY);

        InOrder order = inOrder(mapper, processMapper, effectMapper, internalStateMapper, formulaMapper, parameterMapper);
        order.verify(mapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(effectMapper).deleteLifecycleOperationDetailsForSkill(GAME_ID, SKILL_KEY);
        order.verify(processMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(effectMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(internalStateMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(formulaMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(parameterMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(mapper).delete(GAME_ID, SKILL_KEY);
    }

    @Test
    void deleteSkillRemovesOwnEffectsThenFormulasThenParametersThenSkill() {
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(effectMapper.countExternalSkillScopeReferences(GAME_ID, SKILL_KEY)).thenReturn(0L);
        when(processMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(effectMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(internalStateMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(formulaMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(2);
        when(parameterMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(3);
        when(mapper.delete(GAME_ID, SKILL_KEY)).thenReturn(1);

        service.delete(GAME_ID, SKILL_KEY);

        InOrder order = inOrder(mapper, processMapper, effectMapper, internalStateMapper, formulaMapper, parameterMapper);
        order.verify(mapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(effectMapper).countExternalSkillScopeReferences(GAME_ID, SKILL_KEY);
        order.verify(effectMapper).deleteLifecycleOperationDetailsForSkill(GAME_ID, SKILL_KEY);
        order.verify(processMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(effectMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(internalStateMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(formulaMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(parameterMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(mapper).delete(GAME_ID, SKILL_KEY);
    }

    @Test
    void deleteSkillRejectsExternalCooldownReferencesWithStableConflict() {
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        when(effectMapper.countExternalSkillScopeReferences(GAME_ID, SKILL_KEY)).thenReturn(1L);

        ApiException exception = assertThrows(ApiException.class, () -> service.delete(GAME_ID, SKILL_KEY));
        assertEquals("409.SKILL_IN_USE", exception.getCode());
        verify(processMapper, never()).deleteAllForSkill(GAME_ID, SKILL_KEY);
        verify(effectMapper, never()).deleteLifecycleOperationDetailsForSkill(GAME_ID, SKILL_KEY);
        verify(effectMapper, never()).deleteAllForSkill(GAME_ID, SKILL_KEY);
        verify(internalStateMapper, never()).deleteAllForSkill(GAME_ID, SKILL_KEY);
        verify(formulaMapper, never()).deleteAllForSkill(GAME_ID, SKILL_KEY);
        verify(parameterMapper, never()).deleteAllForSkill(GAME_ID, SKILL_KEY);
        verify(mapper, never()).delete(GAME_ID, SKILL_KEY);
    }

    @Test
    void triggerRuleProtectsCrossSkillSourceAndDeletesOwnRulesBeforeChildren() {
        xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService triggerRuleService =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService.class);
        SkillParameterLevelService levelService = new SkillParameterLevelService(new ObjectMapper());
        SkillService guarded = new SkillService(
            gamesMapper, mapper, parameterMapper, formulaMapper, effectMapper, processMapper,
            internalStateMapper, levelService, triggerRuleService
        );
        when(mapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(row(SKILL_KEY, 10));
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_IN_USE",
            "技能仍被其他技能的触发规则引用，不能删除",
            Map.of("fieldIssues", List.of(Map.of("field", "skillKey", "code", "CONFLICT")))
        )).when(triggerRuleService).assertSourceSkillNotReferenced(GAME_ID, SKILL_KEY);
        ApiException blocked = assertThrows(ApiException.class, () -> guarded.delete(GAME_ID, SKILL_KEY));
        assertEquals("409.SKILL_IN_USE", blocked.getCode());
        verify(triggerRuleService, never()).deleteAllForSkill(GAME_ID, SKILL_KEY);
        verify(processMapper, never()).deleteAllForSkill(GAME_ID, SKILL_KEY);
        verify(mapper, never()).delete(GAME_ID, SKILL_KEY);

        org.mockito.Mockito.reset(triggerRuleService);
        org.mockito.Mockito.clearInvocations(
            mapper, processMapper, effectMapper, internalStateMapper, formulaMapper, parameterMapper
        );
        when(effectMapper.countExternalSkillScopeReferences(GAME_ID, SKILL_KEY)).thenReturn(0L);
        when(processMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(effectMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(internalStateMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(formulaMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(parameterMapper.deleteAllForSkill(GAME_ID, SKILL_KEY)).thenReturn(1);
        when(mapper.delete(GAME_ID, SKILL_KEY)).thenReturn(1);
        guarded.delete(GAME_ID, SKILL_KEY);
        InOrder order = inOrder(
            mapper, triggerRuleService, processMapper, effectMapper, internalStateMapper, formulaMapper, parameterMapper
        );
        order.verify(mapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(triggerRuleService).assertSourceSkillNotReferenced(GAME_ID, SKILL_KEY);
        order.verify(effectMapper).countExternalSkillScopeReferences(GAME_ID, SKILL_KEY);
        order.verify(triggerRuleService).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(effectMapper).deleteLifecycleOperationDetailsForSkill(GAME_ID, SKILL_KEY);
        order.verify(processMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(effectMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(internalStateMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(formulaMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(parameterMapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
        order.verify(mapper).delete(GAME_ID, SKILL_KEY);
    }

    private static SkillParameterRow parameterRow(
        String parameterKey,
        SkillParameterValueMode mode,
        String levelValuesJson
    ) {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillParameterRow(
            GAME_ID,
            SKILL_KEY,
            parameterKey,
            parameterKey,
            SkillParameterValueType.DECIMAL,
            mode,
            null,
            levelValuesJson,
            null,
            10,
            timestamp,
            timestamp
        );
    }

    private static SkillCreateRequest createRequest(List<String> categoryKeys) {
        return createRequest(SKILL_KEY, categoryKeys);
    }

    private static SkillCreateRequest createRequest(String skillKey, List<String> categoryKeys) {
        return new SkillCreateRequest(skillKey, "秘术射击", null, 5, SkillStatus.ENABLED, skillKey.equals("ezreal_w") ? 11 : 10, categoryKeys);
    }

    private static SkillUpdateRequest updateRequest(List<String> categoryKeys) {
        return new SkillUpdateRequest(null, "秘术射击", null, 5, SkillStatus.ENABLED, 10, categoryKeys);
    }

    private static SkillRow row(String skillKey, int sortOrder) {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillRow(
            GAME_ID, skillKey, "秘术射击", null, 5, SkillStatus.ENABLED, sortOrder, timestamp, timestamp
        );
    }

    private static SkillRow disabledRow() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillRow(
            GAME_ID, SKILL_KEY, "秘术射击", null, 5, SkillStatus.DISABLED, 10, timestamp, timestamp
        );
    }

    private static String firstField(ApiException exception) {
        Object issues = exception.getDetails().get("fieldIssues");
        assertInstanceOf(List.class, issues);
        Object first = ((List<?>) issues).getFirst();
        assertInstanceOf(Map.class, first);
        return String.valueOf(((Map<?, ?>) first).get("field"));
    }

    private static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }
}
