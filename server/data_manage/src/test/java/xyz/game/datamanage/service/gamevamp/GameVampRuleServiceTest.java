package xyz.game.datamanage.service.gamevamp;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.model.gamevamp.*;
import xyz.game.datamanage.support.authoring.*;
import xyz.game.datamanage.support.error.ApiException;

class GameVampRuleServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final GamesMapper games = mock(GamesMapper.class);
    private final GameConfigurationWriteGuard writes = mock(GameConfigurationWriteGuard.class);
    private final GameVampRuleService service = new GameVampRuleService(jdbc, games, writes);
    private static final String RULE = """
        {"vampType":"OMNIVAMP","sourceAttributeKey":"omnivamp_percent","basisOutputKind":"POST_DEFENSE_DAMAGE",
         "defaultEfficiency":0,"deliveryKinds":["SKILL","BASIC_ATTACK"],"originKinds":["DIRECT"],"skillCategoryKeys":["common"]}
        """;

    @BeforeEach void catalog() {
        when(games.countGames("lol")).thenReturn(1L);
        when(jdbc.queryForList(GameVampRuleSemantics.ATTRIBUTES_SQL, "lol"))
            .thenReturn(List.of(Map.of("attribute_key", "omnivamp_percent", "value_type", "DECIMAL")));
        when(jdbc.queryForList(GameVampRuleSemantics.CATEGORIES_SQL, String.class, "lol")).thenReturn(List.of("common"));
    }

    @Test void replaceLocksBeforeReadingValidatesAndReadsCanonicalResponse() {
        GameVampRule rule = AggregateJson.read(RULE, GameVampRule.class);
        when(jdbc.queryForList(GameVampRuleSemantics.RULES_SQL, String.class, "lol")).thenReturn(List.of(RULE));
        GameVampRules result = service.replace("lol", new GameVampRules(List.of(rule)));
        assertEquals(BigDecimal.ZERO, result.rules().getFirst().defaultEfficiency());
        var order = inOrder(writes, games, jdbc);
        order.verify(writes).begin("lol");
        order.verify(games).countGames("lol");
        order.verify(jdbc).queryForList(GameVampRuleSemantics.ATTRIBUTES_SQL, "lol");
        order.verify(jdbc).queryForList(GameVampRuleSemantics.CATEGORIES_SQL, String.class, "lol");
        order.verify(jdbc).update("DELETE FROM public.game_vamp_rules WHERE game_id = ?", "lol");
        order.verify(jdbc).update(GameVampRuleService.INSERT_SQL, "lol", "OMNIVAMP", "omnivamp_percent", "POST_DEFENSE_DAMAGE",
            BigDecimal.ZERO, "[\"SKILL\",\"BASIC_ATTACK\"]", "[\"DIRECT\"]", "[\"common\"]");
        order.verify(jdbc).queryForList(GameVampRuleSemantics.RULES_SQL, String.class, "lol");
    }

    @Test void invalidReplacementNeverDeletesExistingRules() {
        GameVampRule rule = AggregateJson.read(RULE, GameVampRule.class);
        ApiException error = assertThrows(ApiException.class,
            () -> service.replace("lol", new GameVampRules(List.of(rule, rule))));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertTrue(error.getDetails().toString().contains("rules[1].vampType"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void emptyReplacementIsAllowedPendingFinalGuardCheckAndGetDoesNotLock() {
        assertEquals(List.of(), service.replace("lol", new GameVampRules(List.of())).rules());
        verify(jdbc).update("DELETE FROM public.game_vamp_rules WHERE game_id = ?", "lol");
        clearInvocations(writes);
        assertEquals(List.of(), service.get("lol").rules());
        verifyNoInteractions(writes);
    }

    @Test void missingGameRejectsReadBeforeRuleQuery() {
        when(games.countGames("other")).thenReturn(0L);
        assertEquals("404.GAME_NOT_FOUND", assertThrows(ApiException.class, () -> service.get("other")).getCode());
        verify(jdbc, never()).queryForList(GameVampRuleSemantics.RULES_SQL, String.class, "other");
    }
}
