package xyz.game.datamanage.service.damagetype;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.damagetype.DamageTypeMapper;
import xyz.game.datamanage.model.damagetype.*;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class DamageTypeFormulaServiceTest {
    private static final OffsetDateTime UPDATED = OffsetDateTime.parse("2026-09-27T08:00:00Z");
    @Mock private GamesMapper games;
    @Mock private DamageTypeMapper mapper;
    @Mock private GameConfigurationWriteGuard writes;
    private DamageTypeService service;

    @BeforeEach void setup() {
        service = new DamageTypeService(games, mapper, writes);
        when(games.countGames("lol")).thenReturn(1L);
    }

    @ParameterizedTest @ValueSource(ints = {1, 2, 6})
    void savesAnyLegalNumberOfNamedResultsAndKeepsDecimalStrings(int count) {
        var formula = (ObjectNode) definition("-0.000");
        var stages = formula.withArray("stages");
        for (int i = 1; i < count; i++) {
            stages.addObject().put("key", "renamed_" + i).put("name", "自定义结果" + i)
                .putObject("expression").put("op", "ref").put("stageKey", "result");
        }
        formula.put("outputStageKey", stages.get(count - 1).path("key").textValue());
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row(null));
        var written = ArgumentCaptor.forClass(String.class);
        when(mapper.updateFormula(eq("lol"), eq("heat"), written.capture())).thenReturn(1);
        when(mapper.findFormulaById("lol", "heat")).thenAnswer(call -> row(written.getValue()));
        var result = service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(formula));
        assertEquals(formula, result.formula());
        assertEquals("-0.000", result.formula().at("/stages/0/expression/value").textValue());
        assertEquals(UPDATED, result.updatedAt());
        verify(writes).begin("lol");
        verify(mapper, never()).findAttributesByKeys(any(), any());
    }

    @Test void realEnabledCatalogAllowsOnlyThisGamesAuthorizedBindings() {
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row(null));
        when(mapper.findAttributesByKeys("lol", java.util.Set.of("armor")))
            .thenReturn(List.of(new DamageTypeFormulaAttributeStatusRow("armor", "ENABLED")));
        when(mapper.updateFormula(eq("lol"), eq("heat"), anyString())).thenReturn(1);
        var formula = definition("1", "armor");
        when(mapper.findFormulaById("lol", "heat")).thenReturn(row(formula.toString()));
        assertEquals(formula, service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(formula)).formula());
        when(mapper.findAttributesByKeys("lol", java.util.Set.of("armor"))).thenReturn(List.of());
        var error = assertThrows(ApiException.class, () -> service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(formula)));
        assertTrue(error.getDetails().toString().contains("FORMULA_UNKNOWN_BINDING"));
        assertTrue(error.getDetails().toString().contains("/formula/inputs/0/binding"));
    }

    @Test void savingNeverGrandfathersAnExistingDisabledAttribute() {
        JsonNode formula = definition("1", "armor");
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row(formula.toString()));
        when(mapper.findAttributesByKeys("lol", java.util.Set.of("armor")))
            .thenReturn(List.of(new DamageTypeFormulaAttributeStatusRow("armor", "DISABLED")));
        var error = assertThrows(ApiException.class, () -> service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(formula)));
        assertTrue(error.getDetails().toString().contains("FORMULA_UNKNOWN_BINDING"));
        verify(mapper, never()).updateFormula(any(), any(), any());
        when(mapper.findFormulaById("lol", "heat")).thenReturn(row(formula.toString()));
        assertEquals(formula, service.getFormula("lol", "heat").formula());
    }

    @ParameterizedTest @ValueSource(strings = {"owner", "event_source", "event_target"})
    void unauthorizedObjectsAreRejected(String object) {
        var formula = (ObjectNode) definition("1", "armor");
        ((ObjectNode) formula.at("/inputs/0/binding")).put("object", object);
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row(null));
        when(mapper.findAttributesByKeys("lol", java.util.Set.of("armor")))
            .thenReturn(List.of(new DamageTypeFormulaAttributeStatusRow("armor", "ENABLED")));
        assertThrows(ApiException.class, () -> service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(formula)));
        verify(mapper, never()).updateFormula(any(), any(), any());
    }

    @ParameterizedTest @ValueSource(strings = {"CURRENT", "MAX", "MISSING", "CURRENT_RATIO", "MISSING_RATIO"})
    void unauthorizedValueKindsAreRejected(String kind) {
        var formula = (ObjectNode) definition("1", "armor");
        ((ObjectNode) formula.at("/inputs/0/binding")).put("valueKind", kind);
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row(null));
        when(mapper.findAttributesByKeys("lol", java.util.Set.of("armor")))
            .thenReturn(List.of(new DamageTypeFormulaAttributeStatusRow("armor", "ENABLED")));
        assertThrows(ApiException.class, () -> service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(formula)));
    }

    @Test void commonErrorsAndOldStructureAreRejectedWithoutWriting() {
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row(null));
        for (var formula : List.of(new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode(),
            ((ObjectNode) definition("1")).put("resistanceFactor", 1), ((ObjectNode) definition("1")).put("outputStageKey", "missing"))) {
            assertThrows(ApiException.class, () -> service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(formula)));
        }
        verify(mapper, never()).updateFormula(any(), any(), any());
    }

    @Test void sharedOverLimitInputFixtureIsRejectedBeforeAnyAttributeCatalogQuery() throws Exception {
        JsonNode overLimit;
        try (var stream = getClass().getResourceAsStream("/formula-contract/cases.generated.json")) {
            var cases = new com.fasterxml.jackson.databind.ObjectMapper().readTree(stream).path("cases");
            overLimit = null;
            for (JsonNode fixture : cases) if ("输入65".equals(fixture.path("name").textValue())) overLimit = fixture.path("definition");
        }
        assertNotNull(overLimit, "同源生成的超限样例必须存在");
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row(null));
        JsonNode request = overLimit;
        var error = assertThrows(ApiException.class, () -> service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(request)));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertTrue(error.getDetails().toString().contains("FORMULA_INVALID_STRUCTURE"));
        assertTrue(error.getDetails().toString().contains("/formula/inputs"));
        verify(mapper, never()).findAttributesByKeys(any(), any());
        verify(mapper, never()).updateFormula(any(), any(), any());
    }

    @Test void readsMissingCorruptAndClearedFormulaWithExplicitResults() {
        when(mapper.findFormulaById("lol", "heat")).thenReturn(row(null));
        assertEquals("404.DAMAGE_TYPE_FORMULA_NOT_FOUND", assertThrows(ApiException.class, () -> service.getFormula("lol", "heat")).getCode());
        when(mapper.findFormulaById("lol", "heat")).thenReturn(row("{}"));
        assertEquals("500.INTERNAL_ERROR", assertThrows(ApiException.class, () -> service.getFormula("lol", "heat")).getCode());
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row(definition("1").toString()));
        when(mapper.clearFormula("lol", "heat")).thenReturn(1);
        service.deleteFormula("lol", "heat");
        verify(writes).begin("lol");
        verify(mapper).clearFormula("lol", "heat");
    }

    @Test void writeFailureDoesNotReadBackAndValidReplacementRepairsCorruption() {
        when(mapper.findFormulaForUpdate("lol", "heat")).thenReturn(row("{}"));
        when(mapper.updateFormula(eq("lol"), eq("heat"), anyString())).thenThrow(new DataIntegrityViolationException("test"));
        assertThrows(DataIntegrityViolationException.class, () -> service.replaceFormula("lol", "heat", new DamageTypeFormulaReplaceRequest(definition("1"))));
        verify(mapper, never()).findFormulaById(any(), any());
    }

    private static DamageTypeFormulaRow row(String formula) { return new DamageTypeFormulaRow("lol", "heat", formula, UPDATED); }
}
