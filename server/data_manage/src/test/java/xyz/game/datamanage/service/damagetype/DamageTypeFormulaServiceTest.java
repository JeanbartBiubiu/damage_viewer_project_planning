package xyz.game.datamanage.service.damagetype;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
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
import xyz.game.datamanage.mapper.damagetype.DamageTypeMapper;
import xyz.game.datamanage.model.damagetype.DamageTypeCalculationFormula;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaAttributeNode;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaAttributeStatusRow;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaFixedNode;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaOperationNode;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaReplaceRequest;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaRow;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaStageResultNode;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeStatus;
import xyz.game.datamanage.model.damagetype.DamageTypeUpdateRequest;
import xyz.game.datamanage.model.skillformula.AttributeOwner;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperation;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class DamageTypeFormulaServiceTest {

    private static final String GAME_ID = "lol";
    private static final String KEY = "physical";
    private static final OffsetDateTime UPDATED = OffsetDateTime.parse("2026-09-27T08:00:00Z");
    private static final ObjectMapper JSON = new ObjectMapper();

    @Mock private GamesMapper gamesMapper;
    @Mock private DamageTypeMapper mapper;
    @Mock private GameConfigurationWriteGuard writes;

    private DamageTypeService service;

    @BeforeEach
    void setUp() {
        service = new DamageTypeService(gamesMapper, mapper, writes);
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void readsReplacesAndClearsFormulaAndKeepsConfiguredFlag() throws Exception {
        when(mapper.findFormulaById(GAME_ID, KEY)).thenReturn(row(stored(allNodeFormula())));
        DamageTypeFormulaResponse loaded = service.getFormula(GAME_ID, KEY);
        assertEquals(GAME_ID, loaded.gameId());
        assertEquals(KEY, loaded.damageTypeKey());
        assertEquals(UPDATED, loaded.updatedAt());
        assertInstanceOf(DamageTypeFormulaAttributeNode.class, loaded.formula().resistanceBeforePenetration());
        verify(writes, never()).begin(any());

        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        when(mapper.findAttributesByKeys(eq(GAME_ID), any())).thenReturn(List.of(
            new DamageTypeFormulaAttributeStatusRow("armor", "ENABLED"),
            new DamageTypeFormulaAttributeStatusRow("lethality", "ENABLED")
        ));
        ArgumentCaptor<String> written = ArgumentCaptor.forClass(String.class);
        when(mapper.updateFormula(eq(GAME_ID), eq(KEY), written.capture())).thenReturn(1);
        when(mapper.findFormulaById(GAME_ID, KEY)).thenAnswer(invocation -> row(written.getValue()));

        DamageTypeFormulaResponse replaced = service.replaceFormula(GAME_ID, KEY, request(allNodeFormula()));

        assertTrue(written.getValue().contains("\"nodeType\":\"OPERATION\""));
        assertTrue(written.getValue().contains("\"nodeType\":\"FIXED\""));
        assertTrue(written.getValue().contains("\"nodeType\":\"ATTRIBUTE\""));
        assertTrue(written.getValue().contains("\"nodeType\":\"STAGE_RESULT\""));
        assertFalse(written.getValue().contains("PARAMETER"));
        assertEquals(replaced.formula(), service.getFormula(GAME_ID, KEY).formula());
        InOrder order = inOrder(writes, gamesMapper, mapper);
        order.verify(writes).begin(GAME_ID);
        order.verify(gamesMapper).countGames(GAME_ID);
        order.verify(mapper).findFormulaForUpdate(GAME_ID, KEY);
        order.verify(mapper).updateFormula(eq(GAME_ID), eq(KEY), anyString());
        order.verify(mapper).findFormulaById(GAME_ID, KEY);

        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(written.getValue()));
        when(mapper.clearFormula(GAME_ID, KEY)).thenReturn(1);
        service.deleteFormula(GAME_ID, KEY);
        verify(mapper).clearFormula(GAME_ID, KEY);

        DamageTypeResponse configured = new DamageTypeResponse(
            GAME_ID, KEY, "物理", null, DamageTypeStatus.ENABLED, 1,
            UPDATED, UPDATED, true
        );
        when(mapper.findById(GAME_ID, KEY)).thenReturn(configured);
        when(mapper.list(GAME_ID, null, null)).thenReturn(List.of(configured));
        assertTrue(service.get(GAME_ID, KEY).formulaConfigured());
        assertTrue(service.list(GAME_ID, null).items().getFirst().formulaConfigured());
    }

    @Test
    void basicUpdateDoesNotClearFormulaAndMissingFormulaIsNotFound() {
        when(mapper.findByIdForUpdate(GAME_ID, KEY)).thenReturn(damageType(true));
        when(mapper.countByNormalizedName(GAME_ID, "物理", KEY)).thenReturn(0L);
        when(mapper.update(GAME_ID, KEY, "物理", null, "ENABLED", 1)).thenReturn(1);
        when(mapper.findById(GAME_ID, KEY)).thenReturn(damageType(true));

        assertTrue(service.update(
            GAME_ID, KEY, new DamageTypeUpdateRequest(null, "物理", null, DamageTypeStatus.ENABLED, 1)
        ).formulaConfigured());
        verify(mapper, never()).updateFormula(any(), any(), any());
        verify(mapper, never()).clearFormula(any(), any());

        when(mapper.findFormulaById(GAME_ID, KEY)).thenReturn(row(null));
        assertEquals("404.DAMAGE_TYPE_FORMULA_NOT_FOUND", assertThrows(ApiException.class,
            () -> service.getFormula(GAME_ID, KEY)).getCode());
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        assertEquals("404.DAMAGE_TYPE_FORMULA_NOT_FOUND", assertThrows(ApiException.class,
            () -> service.deleteFormula(GAME_ID, KEY)).getCode());
        verify(mapper, never()).clearFormula(any(), any());
    }

    @Test
    void missingGameOrDamageTypeStopsBeforeFormulaWrite() throws Exception {
        when(gamesMapper.countGames("missing")).thenReturn(0L);
        ApiException missingGame = assertThrows(ApiException.class,
            () -> service.replaceFormula("missing", KEY, request(fixedFormula("0"))));
        assertEquals("404.GAME_NOT_FOUND", missingGame.getCode());

        when(mapper.findFormulaForUpdate(GAME_ID, "missing")).thenReturn(null);
        ApiException missingType = assertThrows(ApiException.class,
            () -> service.replaceFormula(GAME_ID, "missing", request("[]")));
        assertEquals("404.DAMAGE_TYPE_NOT_FOUND", missingType.getCode());
        verify(mapper, never()).updateFormula(any(), any(), any());
        verify(mapper, never()).findAttributesByKeys(any(), any());
    }

    @Test
    void acceptsDepth32And255NodesAndRejectsDeeperOrLargerTrees() throws Exception {
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        when(mapper.updateFormula(eq(GAME_ID), eq(KEY), anyString())).thenReturn(1);
        when(mapper.findFormulaById(GAME_ID, KEY)).thenReturn(row(stored(fixedFormula("1"))));

        service.replaceFormula(GAME_ID, KEY, request(stages(chain(31), fixed("1"), fixed("1"), fixed("1"), fixed("1"))));
        service.replaceFormula(GAME_ID, KEY, request(stages(full(8), fixed("1"), fixed("1"), fixed("1"), fixed("1"))));

        ApiException depth = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(stages(fixed("1"), fixed("1"), fixed("1"), fixed("1"), chain(32)))));
        assertEquals("400.VALIDATION_FAILED", depth.getCode());
        assertIssue(depth, "formula.resistanceFactor" + ".operands[0]".repeat(32), "DEPTH_LIMIT");

        ApiException nodes = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(stages(full(9), fixed("1"), fixed("1"), fixed("1"), fixed("1")))));
        assertEquals("400.VALIDATION_FAILED", nodes.getCode());
        assertIssue(nodes, "formula.resistanceBeforePenetration.operands[1]", "NODE_LIMIT");
    }

    @Test
    void rejectsExtraFieldsMutexOperandCountAndFixedShapeTogether() throws Exception {
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        String resistance = "{\"nodeType\":\"FIXED\",\"value\":\"12\",\"attributeKey\":\"armor\",\"comment\":true}";
        String percent = "{\"nodeType\":\"OPERATION\",\"operation\":\"ADD\",\"value\":1,\"operands\":[" + fixed("1") + "]}";
        ApiException error = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(stages(resistance, percent, fixed("true"), "{\"nodeType\":\"FIXED\"}", fixed("1")))));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertIssue(error, "formula.resistanceBeforePenetration.value", "VALUE_SHAPE");
        assertIssue(error, "formula.resistanceBeforePenetration.attributeKey", "FIELD_MUTEX");
        assertIssue(error, "formula.resistanceBeforePenetration.comment", "UNKNOWN_FIELD");
        assertIssue(error, "formula.penetrationPercent.operands", "OPERAND_COUNT");
        assertIssue(error, "formula.penetrationPercent.value", "FIELD_MUTEX");
        assertIssue(error, "formula.penetrationFlat.value", "VALUE_SHAPE");
        assertIssue(error, "formula.effectiveResistance.value", "REQUIRED");
        verify(mapper, never()).updateFormula(any(), any(), any());
    }

    @Test
    void rejectsUnboundNodeTypeAndEnumWhileReturningEveryLocatedIssue() throws Exception {
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        String parameter = "{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"damage\"}";
        String badOperation = "{\"nodeType\":\"OPERATION\",\"operation\":\"POWER\",\"operands\":["
            + fixed("1") + "," + fixed("1") + "]}";
        ApiException error = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(stages(parameter, badOperation, "[]", fixed("1"), "{}"))));
        assertEquals("400.INVALID_BODY", error.getCode());
        assertIssue(error, "formula.resistanceBeforePenetration.nodeType", "ENUM_INVALID");
        assertIssue(error, "formula.penetrationPercent.operation", "ENUM_INVALID");
        assertIssue(error, "formula.penetrationFlat", "TYPE_INVALID");
        assertIssue(error, "formula.resistanceFactor.nodeType", "REQUIRED");
        verify(mapper, never()).updateFormula(any(), any(), any());

        ApiException missing = assertThrows(ApiException.class,
            () -> service.replaceFormula(GAME_ID, KEY, new DamageTypeFormulaReplaceRequest(null)));
        assertEquals("400.VALIDATION_FAILED", missing.getCode());
        assertIssue(missing, "formula", "REQUIRED");
    }

    @Test
    void treatsMissingNodeTypeAsAFormulaStructureValidationError() throws Exception {
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        ApiException error = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID,
            KEY,
            request(stages("{}", fixed("0"), fixed("0"), fixed("0"), fixed("1")))
        ));

        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertIssue(error, "formula.resistanceBeforePenetration.nodeType", "REQUIRED");
        verify(mapper, never()).updateFormula(any(), any(), any());
    }

    @Test
    void acceptsForwardStageReferencesAndRejectsSameLaterUnknownAndBackwardRefs() throws Exception {
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        when(mapper.findAttributesByKeys(eq(GAME_ID), any())).thenReturn(List.of(
            new DamageTypeFormulaAttributeStatusRow("armor", "ENABLED"),
            new DamageTypeFormulaAttributeStatusRow("lethality", "ENABLED")
        ));
        when(mapper.updateFormula(eq(GAME_ID), eq(KEY), anyString())).thenReturn(1);
        when(mapper.findFormulaById(GAME_ID, KEY)).thenReturn(row(stored(legalStageFormula())));
        DamageTypeFormulaResponse saved = service.replaceFormula(GAME_ID, KEY, request(legalStageFormula()));
        DamageTypeFormulaOperationNode factor =
            (DamageTypeFormulaOperationNode) saved.formula().resistanceFactor();
        assertEquals(SkillFormulaOperation.MAX, factor.operation());
        assertEquals(
            "EFFECTIVE_RESISTANCE",
            ((DamageTypeFormulaStageResultNode) factor.operands().get(0)).stageKey().name()
        );

        ApiException refs = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(stages(
                stage("PENETRATION_PERCENT"),
                stage("PENETRATION_PERCENT"),
                stage("EFFECTIVE_RESISTANCE"),
                stage("NOT_A_STAGE"),
                stage("RESISTANCE_BEFORE_PENETRATION")
            ))));
        assertEquals("400.INVALID_DAMAGE_TYPE_FORMULA_REFERENCE", refs.getCode());
        List<Map<String, String>> issues = issues(refs);
        assertEquals(4, issues.size());
        assertIssue(refs, "formula.resistanceBeforePenetration.stageKey", "STAGE_REFERENCE_INVALID");
        assertIssue(refs, "formula.penetrationPercent.stageKey", "STAGE_REFERENCE_INVALID");
        assertIssue(refs, "formula.penetrationFlat.stageKey", "STAGE_REFERENCE_INVALID");
        assertIssue(refs, "formula.effectiveResistance.stageKey", "STAGE_REFERENCE_INVALID");
        verify(mapper, never()).updateFormula(eq(GAME_ID), eq(KEY), org.mockito.ArgumentMatchers.contains("NOT_A_STAGE"));
    }

    @Test
    void rejectsUnknownAttributesAndNewDisabledTriplesButKeepsAnExistingTriple() throws Exception {
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        when(mapper.findAttributesByKeys(eq(GAME_ID), any())).thenReturn(List.of());
        ApiException unknown = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(stages(
                attribute("TARGET", "armor", "TOTAL"),
                attribute("SOURCE", "other_game_armor", "BASE"),
                fixed("0"),
                stage("NOPE"),
                fixed("1")
            ))));
        assertEquals("400.INVALID_DAMAGE_TYPE_FORMULA_REFERENCE", unknown.getCode());
        assertIssue(unknown, "formula.resistanceBeforePenetration.attributeKey", "UNKNOWN_ATTRIBUTE");
        assertIssue(unknown, "formula.penetrationPercent.attributeKey", "UNKNOWN_ATTRIBUTE");
        assertIssue(unknown, "formula.effectiveResistance.stageKey", "STAGE_REFERENCE_INVALID");
        assertTrue(issues(unknown).stream().noneMatch(issue -> "FORMULA_ATTRIBUTE_DISABLED".equals(issue.get("code"))));

        when(mapper.findAttributesByKeys(eq(GAME_ID), any())).thenReturn(List.of(
            new DamageTypeFormulaAttributeStatusRow("armor", "DISABLED")
        ));
        ApiException mixed = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(stages(
                attribute("TARGET", "armor", "TOTAL"),
                attribute("SOURCE", "missing", "TOTAL"),
                fixed("0"),
                stage("NOPE"),
                fixed("1")
            ))));
        assertEquals("400.INVALID_DAMAGE_TYPE_FORMULA_REFERENCE", mixed.getCode());
        assertIssue(mixed, "formula.resistanceBeforePenetration.attributeKey", "FORMULA_ATTRIBUTE_DISABLED");
        assertIssue(mixed, "formula.penetrationPercent.attributeKey", "UNKNOWN_ATTRIBUTE");
        assertIssue(mixed, "formula.effectiveResistance.stageKey", "STAGE_REFERENCE_INVALID");

        when(mapper.findAttributesByKeys(eq(GAME_ID), any())).thenReturn(List.of(
            new DamageTypeFormulaAttributeStatusRow("armor", "DISABLED")
        ));
        ApiException created = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(attributeFormula("TARGET", "armor", "TOTAL"))));
        assertEquals("409.FORMULA_ATTRIBUTE_DISABLED", created.getCode());
        assertEquals(GAME_ID, created.getDetails().get("gameId"));
        assertIssue(created, "formula.resistanceBeforePenetration.attributeKey", "FORMULA_ATTRIBUTE_DISABLED");

        String existing = stored(attributeFormula("TARGET", "armor", "TOTAL"));
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(existing));
        when(mapper.updateFormula(eq(GAME_ID), eq(KEY), anyString())).thenReturn(1);
        when(mapper.findFormulaById(GAME_ID, KEY)).thenReturn(row(existing));
        DamageTypeFormulaAttributeNode kept = (DamageTypeFormulaAttributeNode) service.replaceFormula(
            GAME_ID, KEY, request(attributeFormula("TARGET", "armor", "TOTAL"))
        ).formula().resistanceBeforePenetration();
        assertEquals(AttributeOwner.TARGET, kept.attributeOwner());
        assertEquals("armor", kept.attributeKey());
        assertEquals(AttributeValueKind.TOTAL, kept.attributeValueKind());

        ApiException changedKind = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(attributeFormula("TARGET", "armor", "BONUS"))));
        assertEquals("409.FORMULA_ATTRIBUTE_DISABLED", changedKind.getCode());
        ApiException changedOwner = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(attributeFormula("SOURCE", "armor", "TOTAL"))));
        assertEquals("409.FORMULA_ATTRIBUTE_DISABLED", changedOwner.getCode());
        ApiException changedKey = assertThrows(ApiException.class, () -> service.replaceFormula(
            GAME_ID, KEY, request(stages(
                attribute("TARGET", "armor", "TOTAL"),
                attribute("TARGET", "armor", "CURRENT"),
                fixed("0"), fixed("0"), fixed("1")
            ))));
        assertEquals("409.FORMULA_ATTRIBUTE_DISABLED", changedKey.getCode());
        assertIssue(changedKey, "formula.penetrationPercent.attributeKey", "FORMULA_ATTRIBUTE_DISABLED");
    }

    @Test
    void failedWriteDoesNotReadBackAndCorruptStoredFormulaIsNotReplaced() throws Exception {
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        when(mapper.updateFormula(eq(GAME_ID), eq(KEY), anyString()))
            .thenThrow(new DataIntegrityViolationException("check"));
        assertThrows(DataIntegrityViolationException.class,
            () -> service.replaceFormula(GAME_ID, KEY, request(fixedFormula("1"))));
        verify(mapper, never()).findFormulaById(GAME_ID, KEY);

        org.mockito.Mockito.clearInvocations(mapper);
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row("{\"not\":\"formula\"}"));
        when(mapper.findFormulaById(GAME_ID, KEY)).thenReturn(row("{\"not\":\"formula\"}"));
        ApiException corrupt = assertThrows(ApiException.class, () -> service.getFormula(GAME_ID, KEY));
        assertEquals("500.INTERNAL_ERROR", corrupt.getCode());
        ApiException replace = assertThrows(ApiException.class,
            () -> service.replaceFormula(GAME_ID, KEY, request(fixedFormula("1"))));
        assertEquals("500.INTERNAL_ERROR", replace.getCode());
        verify(mapper, never()).updateFormula(any(), any(), any());
    }

    @Test
    void trimsAttributeKeyAndKeepsFiniteFixedValues() throws Exception {
        when(mapper.findFormulaForUpdate(GAME_ID, KEY)).thenReturn(row(null));
        when(mapper.findAttributesByKeys(eq(GAME_ID), any())).thenReturn(List.of(
            new DamageTypeFormulaAttributeStatusRow("armor", "ENABLED")
        ));
        ArgumentCaptor<String> written = ArgumentCaptor.forClass(String.class);
        when(mapper.updateFormula(eq(GAME_ID), eq(KEY), written.capture())).thenReturn(1);
        when(mapper.findFormulaById(GAME_ID, KEY)).thenAnswer(invocation -> row(written.getValue()));

        DamageTypeCalculationFormula formula = service.replaceFormula(GAME_ID, KEY, request(stages(
            attribute("TARGET", " armor ", "CURRENT_RATIO"),
            fixed("-2.5"),
            fixed("0"),
            fixed("10"),
            fixed("1")
        ))).formula();
        DamageTypeFormulaAttributeNode attribute = (DamageTypeFormulaAttributeNode) formula.resistanceBeforePenetration();
        assertEquals("armor", attribute.attributeKey());
        assertEquals(AttributeValueKind.CURRENT_RATIO, attribute.attributeValueKind());
        assertEquals(0, new BigDecimal("-2.5").compareTo(
            ((DamageTypeFormulaFixedNode) formula.penetrationPercent()).value()));
        verify(mapper).findAttributesByKeys(eq(GAME_ID), eq(java.util.Set.of("armor")));
    }

    private static DamageTypeFormulaRow row(String formula) {
        return new DamageTypeFormulaRow(GAME_ID, KEY, formula, UPDATED);
    }

    private static DamageTypeResponse damageType(boolean configured) {
        return new DamageTypeResponse(
            GAME_ID, KEY, "物理", null, DamageTypeStatus.ENABLED, 1, UPDATED, UPDATED, configured
        );
    }

    private static DamageTypeFormulaReplaceRequest request(String formula) throws Exception {
        JsonNode body = JSON.readTree("{\"formula\":" + formula + "}");
        return new DamageTypeFormulaReplaceRequest(body.get("formula"));
    }

    private static String stored(String formula) {
        return formula;
    }

    private static String fixedFormula(String number) {
        return stages(fixed(number), fixed(number), fixed(number), fixed(number), fixed(number));
    }

    private static String allNodeFormula() {
        return stages(
            attribute("TARGET", "armor", "TOTAL"),
            operation("ADD", attribute("SOURCE", "lethality", "BONUS"), stage("RESISTANCE_BEFORE_PENETRATION")),
            operation("MIN", stage("PENETRATION_PERCENT"), fixed("0")),
            operation("SUBTRACT", stage("RESISTANCE_BEFORE_PENETRATION"), stage("PENETRATION_FLAT")),
            operation("MAX", stage("EFFECTIVE_RESISTANCE"), fixed("1"))
        );
    }

    private static String legalStageFormula() {
        return allNodeFormula();
    }

    private static String attributeFormula(String owner, String key, String kind) {
        return stages(attribute(owner, key, kind), fixed("0"), fixed("0"), fixed("0"), fixed("1"));
    }

    private static String stages(String resistance, String percent, String flat, String effective, String factor) {
        return "{"
            + "\"resistanceBeforePenetration\":" + resistance + ","
            + "\"penetrationPercent\":" + percent + ","
            + "\"penetrationFlat\":" + flat + ","
            + "\"effectiveResistance\":" + effective + ","
            + "\"resistanceFactor\":" + factor
            + "}";
    }

    private static String fixed(String number) {
        return "{\"nodeType\":\"FIXED\",\"value\":" + number + "}";
    }

    private static String attribute(String owner, String key, String kind) {
        return "{\"nodeType\":\"ATTRIBUTE\",\"attributeOwner\":\"" + owner
            + "\",\"attributeKey\":\"" + key + "\",\"attributeValueKind\":\"" + kind + "\"}";
    }

    private static String stage(String key) {
        return "{\"nodeType\":\"STAGE_RESULT\",\"stageKey\":\"" + key + "\"}";
    }

    private static String operation(String operation, String left, String right) {
        return "{\"nodeType\":\"OPERATION\",\"operation\":\"" + operation + "\",\"operands\":[" + left + "," + right + "]}";
    }

    private static String chain(int wraps) {
        String node = fixed("1");
        for (int index = 0; index < wraps; index++) {
            node = operation("ADD", node, fixed("1"));
        }
        return node;
    }

    private static String full(int levels) {
        if (levels <= 1) {
            return fixed("1");
        }
        String child = full(levels - 1);
        return operation("ADD", child, child);
    }

    private static void assertIssue(ApiException error, String field, String code) {
        assertTrue(issues(error).stream().anyMatch(issue ->
            field.equals(issue.get("field")) && code.equals(issue.get("code"))), issues(error).toString());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> issues(ApiException error) {
        return (List<Map<String, String>>) error.getDetails().get("fieldIssues");
    }
}
