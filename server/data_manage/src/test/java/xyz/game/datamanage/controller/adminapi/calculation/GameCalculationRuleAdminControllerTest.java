package xyz.game.datamanage.controller.adminapi.calculation;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.service.calculation.GameCalculationRuleService;
import xyz.game.datamanage.support.authoring.GameCalculationRuleSemantics;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

class GameCalculationRuleAdminControllerTest {
    private static final String PATH = "/api/admin/games/example/calculation-rules";
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final GamesMapper games = mock(GamesMapper.class);
    private final AdminEditLogHelper logs = mock(AdminEditLogHelper.class);
    private final GameConfigurationWriteGuard writes = mock(GameConfigurationWriteGuard.class);
    private final GameCalculationRuleService service = new GameCalculationRuleService(jdbc, games, writes, new ObjectMapper());
    private final AtomicReference<String> stored = new AtomicReference<>();
    private MockMvc mvc;

    @BeforeEach void setupRealServiceAndIsolatedDatabase() {
        when(games.countGames("example")).thenReturn(1L);
        when(jdbc.queryForList(GameCalculationRuleSemantics.RULES_SQL, String.class, "example"))
            .thenAnswer(ignored -> stored.get() == null ? List.of() : List.of(stored.get()));
        when(jdbc.queryForList(GameCalculationRuleSemantics.ATTRIBUTES_SQL, "example")).thenReturn(List.of());
        when(jdbc.update(anyString(), eq("example"), anyString())).thenAnswer(invocation -> {
            stored.set(invocation.getArgument(2));
            return 1;
        });
        mvc = MockMvcBuilders.standaloneSetup(new GameCalculationRuleAdminController(service, logs))
            .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test void completeReplacementReturnsConfigurationAndIndependentGetPreservesNullAndZero() throws Exception {
        var before = mvc.perform(get(PATH)).andExpect(status().isOk()).andExpect(jsonPath("$.gameId").value("example"))
            .andExpect(jsonPath("$.configuration").value(org.hamcrest.Matchers.nullValue())).andReturn();
        String digest = new ObjectMapper().readTree(before.getResponse().getContentAsString()).path("baseDigest").textValue();
        mvc.perform(put(PATH).contentType(MediaType.APPLICATION_JSON).content(body(digest, "0"))
                .requestAttr(AdminAuthFilter.AUTH_CONTEXT_ATTR, new AuthContext("admin@example.com", true, true)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.configuration.criticalMultiplierMin").value(0))
            .andExpect(jsonPath("$.configuration.criticalChanceAttributeKey").value(org.hamcrest.Matchers.nullValue()));
        mvc.perform(get(PATH)).andExpect(status().isOk()).andExpect(jsonPath("$.configuration.criticalMultiplierMin").value(0))
            .andExpect(jsonPath("$.configuration.attributeDerivations").isEmpty());
        verify(logs).log(any(), any(), any(), eq(200));
    }

    @Test void conflictReturnsCurrentDigestAndKeepsTheStoredConfiguration() throws Exception {
        String digest = service.get("example").baseDigest();
        service.replace("example", xyz.game.datamanage.support.authoring.AggregateJson.tree(body(digest, "null")));
        String current = service.get("example").baseDigest();
        mvc.perform(put(PATH).contentType(MediaType.APPLICATION_JSON).content(body(digest, "1"))
                .requestAttr(AdminAuthFilter.AUTH_CONTEXT_ATTR, new AuthContext("admin@example.com", true, true)))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("409.GAME_CALCULATION_RULES_CHANGED"))
            .andExpect(jsonPath("$.error.details.baseDigest").value(current));
        verifyNoInteractions(logs);
    }

    @Test void unknownFieldReturnsValidationPointerInsteadOfBeingIgnoredByDeserialization() throws Exception {
        String request = body(service.get("example").baseDigest(), "null").replace("\"attributeDerivations\":[]", "\"attributeDerivations\":[],\"oldRules\":[]");
        mvc.perform(put(PATH).contentType(MediaType.APPLICATION_JSON).content(request)
                .requestAttr(AdminAuthFilter.AUTH_CONTEXT_ATTR, new AuthContext("admin@example.com", true, true)))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("/configuration/oldRules"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("UNKNOWN_FIELD"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verifyNoInteractions(logs);
    }

    private static String body(String digest, String minimum) {
        return "{\"baseDigest\":\"" + digest + "\",\"configuration\":{\"criticalChanceAttributeKey\":null,\"criticalMultiplierMin\":"
            + minimum + ",\"attackSpeedAttributeKey\":null,\"attributeDerivations\":[]}}";
    }
}
