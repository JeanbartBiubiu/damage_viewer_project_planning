package xyz.game.datamanage.service.calculation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.GameCalculationRuleSemantics;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

class GameCalculationRuleServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final GamesMapper games = mock(GamesMapper.class);
    private final GameConfigurationWriteGuard writes = mock(GameConfigurationWriteGuard.class);
    private final GameCalculationRuleService service = new GameCalculationRuleService(jdbc, games, writes, new ObjectMapper());
    private final AtomicReference<String> stored = new AtomicReference<>();
    private static final String CONFIGURATION = """
        {"criticalChanceAttributeKey":"chance","criticalMultiplierMin":0,"attackSpeedAttributeKey":"velocity","attributeDerivations":[],
         "basicAttackCategoryKey":null,"equipmentPassiveCategoryKey":null,"ignorableCastCostAttributeKeys":[]}
        """;

    @BeforeEach void databaseDouble() {
        when(games.countGames("example")).thenReturn(1L);
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "example"))
            .thenAnswer(ignored -> stored.get() == null ? List.of() : List.of(stored.get()));
        when(jdbc.queryForList(GameCalculationRuleSemantics.ATTRIBUTES_SQL, "example")).thenReturn(List.of(
            Map.of("attribute_key", "chance", "value_type", "DECIMAL", "status", "ENABLED"),
            Map.of("attribute_key", "velocity", "value_type", "INTEGER", "status", "ENABLED")));
        when(jdbc.queryForList(GameCalculationRuleSemantics.CATEGORIES_SQL, "example")).thenReturn(List.of(
            Map.of("skill_category_key", "renamed_attack", "status", "ENABLED"),
            Map.of("skill_category_key", "renamed_passive", "status", "ENABLED"),
            Map.of("skill_category_key", "disabled", "status", "DISABLED")));
        when(jdbc.update(eq(GameCalculationRuleService.UPSERT_SQL), eq("example"), anyString())).thenAnswer(invocation -> {
            stored.set(invocation.getArgument(2));
            return 1;
        });
    }

    @Test void emptyStateIsExplicitStableAndSpecificToTheGame() {
        var empty = service.get("example");
        assertNull(empty.configuration());
        assertEquals(64, empty.baseDigest().length());
        assertEquals(empty.baseDigest(), service.get("example").baseDigest());
        when(games.countGames("second")).thenReturn(1L);
        assertNotEquals(empty.baseDigest(), service.get("second").baseDigest());
        verifyNoInteractions(writes);
    }

    @Test void fullReplacementLocksBeforeBaselineChecksAndPerformsIndependentReadBack() {
        var request = request(service.get("example").baseDigest(), CONFIGURATION);
        String before = request.toString();
        clearInvocations(writes, games, jdbc);
        var saved = service.replace("example", request);
        assertEquals(before, request.toString());
        assertEquals(0, saved.configuration().path("criticalMultiplierMin").intValue());
        assertEquals(saved, service.get("example"));
        var order = inOrder(writes, games, jdbc);
        order.verify(writes).begin("example");
        order.verify(games).countGames("example");
        order.verify(jdbc).queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "example");
        order.verify(jdbc).queryForList(GameCalculationRuleSemantics.ATTRIBUTES_SQL, "example");
        order.verify(jdbc).queryForList(GameCalculationRuleSemantics.CATEGORIES_SQL, "example");
        order.verify(jdbc).update(GameCalculationRuleService.UPSERT_SQL, "example", AggregateJson.write(request.path("configuration")));
        order.verify(jdbc).queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "example");
    }

    @Test void staleBaseRejectsBeforeWriteAndReturnsTheCurrentDigest() {
        String emptyDigest = service.get("example").baseDigest();
        service.replace("example", request(emptyDigest, CONFIGURATION));
        clearInvocations(jdbc);
        var current = service.get("example");
        ApiException error = assertThrows(ApiException.class, () -> service.replace("example", request(emptyDigest, CONFIGURATION)));
        assertEquals("409.GAME_CALCULATION_RULES_CHANGED", error.getCode());
        assertEquals(current.baseDigest(), error.getDetails().get("baseDigest"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verify(jdbc, never()).queryForList(GameCalculationRuleSemantics.ATTRIBUTES_SQL, "example");
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}", "{\"configuration\":null,\"baseDigest\":\"x\"}", "[]"})
    void malformedRequestNeverWrites(String raw) {
        assertEquals("400.VALIDATION_FAILED", assertThrows(ApiException.class, () -> service.replace("example", AggregateJson.tree(raw))).getCode());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void nullCandidateDisabledDirectoryAndUnknownRequestFieldNeverReplaceTheOriginal() {
        String digest = service.get("example").baseDigest();
        for (String configuration : List.of("null", CONFIGURATION.replace("chance", "missing"))) {
            assertEquals("400.VALIDATION_FAILED", assertThrows(ApiException.class,
                () -> service.replace("example", request(digest, configuration))).getCode());
        }
        var unknown = (com.fasterxml.jackson.databind.node.ObjectNode) request(digest, CONFIGURATION);
        unknown.put("legacy", true);
        var error = assertThrows(ApiException.class, () -> service.replace("example", unknown));
        assertTrue(error.getDetails().toString().contains("/legacy"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        assertNull(stored.get());
    }

    @Test void digestIgnoresObjectFieldOrderAndNumericScaleButPreservesConstantText() {
        stored.set(CONFIGURATION);
        String first = service.get("example").baseDigest();
        stored.set("{\"ignorableCastCostAttributeKeys\":[],\"equipmentPassiveCategoryKey\":null,\"basicAttackCategoryKey\":null,\"attributeDerivations\":[],\"attackSpeedAttributeKey\":\"velocity\",\"criticalMultiplierMin\":0.00,\"criticalChanceAttributeKey\":\"chance\"}");
        assertEquals(first, service.get("example").baseDigest());
        stored.set(CONFIGURATION.replace("\"criticalMultiplierMin\":0", "\"criticalMultiplierMin\":null"));
        assertNotEquals(first, service.get("example").baseDigest());
    }

    @Test void lifeActivationCannotReplaceTheExistingConfigurationEvenWhenItsDirectoryEntryIsEnabled() {
        stored.set(CONFIGURATION);
        String digest = service.get("example").baseDigest();
        when(jdbc.queryForList(GameCalculationRuleSemantics.ATTRIBUTES_SQL, "example")).thenReturn(List.of(
            Map.of("attribute_key", "chance", "value_type", "DECIMAL", "status", "ENABLED"),
            Map.of("attribute_key", "velocity", "value_type", "INTEGER", "status", "ENABLED"),
            Map.of("attribute_key", "hp", "value_type", "INTEGER", "status", "ENABLED")));
        String candidate = CONFIGURATION.replace("\"attributeDerivations\":[]", """
            "attributeDerivations":[{"ruleKey":"rule","attributeKey":"velocity","valuePolicy":"set",
              "activationAttributeKeys":["chance","hp"],"formula":{"inputs":[],"stages":[{"key":"result","name":"结果",
                "expression":{"op":"const","value":"1"}}],"outputStageKey":"result"}}]
            """.strip());
        var error = assertThrows(ApiException.class, () -> service.replace("example", request(digest, candidate)));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        var issue = (Map<?, ?>) ((List<?>) error.getDetails().get("fieldIssues")).getFirst();
        assertEquals("/configuration/attributeDerivations/0/activationAttributeKeys/1", issue.get("field"));
        assertEquals("LIFE_ACTIVATION_FORBIDDEN", issue.get("code"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        assertEquals(CONFIGURATION, stored.get());
        assertEquals(digest, service.get("example").baseDigest());
    }

    @Test void mismatchedWriteReadBackFailsInsteadOfReportingSuccess() {
        when(jdbc.update(eq(GameCalculationRuleService.UPSERT_SQL), eq("example"), anyString())).thenReturn(1);
        assertThrows(IllegalStateException.class, () -> service.replace("example", request(service.get("example").baseDigest(), CONFIGURATION)));
    }

    @Test void fullCustomUsageReplacementReadsBackAllNewFieldsAndChangesTheDigest() {
        service.replace("example", request(service.get("example").baseDigest(), CONFIGURATION));
        var before = service.get("example");
        var candidate = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(CONFIGURATION);
        candidate.put("basicAttackCategoryKey", "renamed_attack").put("equipmentPassiveCategoryKey", "renamed_passive");
        candidate.putArray("ignorableCastCostAttributeKeys").add("velocity").add("chance");
        var saved = service.replace("example", request(before.baseDigest(), candidate.toString()));
        assertEquals(candidate, service.get("example").configuration());
        assertNotEquals(before.baseDigest(), saved.baseDigest());
        var changed = candidate.deepCopy();
        changed.putNull("equipmentPassiveCategoryKey");
        var unbound = service.replace("example", request(saved.baseDigest(), changed.toString()));
        assertNotEquals(saved.baseDigest(), unbound.baseDigest());
        changed.putArray("ignorableCastCostAttributeKeys").add("chance").add("velocity");
        var reordered = service.replace("example", request(unbound.baseDigest(), changed.toString()));
        assertNotEquals(unbound.baseDigest(), reordered.baseDigest());
        assertEquals(changed, service.get("example").configuration());
        assertEquals("409.GAME_CALCULATION_RULES_CHANGED", assertThrows(ApiException.class,
            () -> service.replace("example", request(before.baseDigest(), candidate.toString()))).getCode());
    }

    @Test void invalidUsageCandidatesCannotWriteOrChangeTheBaseline() {
        stored.set(CONFIGURATION);
        var before = service.get("example");
        for (String scenario : List.of("missing", "disabled", "foreign", "conflict", "duplicate_cost", "foreign_cost")) {
            var candidate = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(CONFIGURATION);
            switch (scenario) {
                case "missing" -> candidate.remove("ignorableCastCostAttributeKeys");
                case "disabled" -> candidate.put("basicAttackCategoryKey", "disabled");
                case "foreign" -> candidate.put("equipmentPassiveCategoryKey", "another_game");
                case "conflict" -> candidate.put("basicAttackCategoryKey", "renamed_attack").put("equipmentPassiveCategoryKey", "renamed_attack");
                case "duplicate_cost" -> candidate.putArray("ignorableCastCostAttributeKeys").add("chance").add("chance");
                default -> candidate.putArray("ignorableCastCostAttributeKeys").add("another_game");
            }
            assertEquals("400.VALIDATION_FAILED", assertThrows(ApiException.class,
                () -> service.replace("example", request(before.baseDigest(), candidate.toString()))).getCode());
            assertEquals(before, service.get("example"));
        }
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void nonexistentGameRejectsBeforeConfigurationRead() {
        when(games.countGames("missing")).thenReturn(0L);
        assertEquals("404.GAME_NOT_FOUND", assertThrows(ApiException.class, () -> service.get("missing")).getCode());
        verify(jdbc, never()).queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "missing");
    }

    private static JsonNode request(String digest, String configuration) {
        return AggregateJson.tree("{\"baseDigest\":\"" + digest + "\",\"configuration\":" + configuration + "}");
    }
}
