package xyz.game.datamanage.controller.adminapi.simulation;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.service.simulation.SimulationSnapshotService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

class SimulationSnapshotAdminControllerTest {
    private static final String URL = "/api/admin/games/lol/simulation-snapshot";
    private static final Selection CHOICE = new Selection("hero_a", 1, "hero_b", 2, "shared_basic_attack", 1);
    private final SimulationSnapshotService service = mock(SimulationSnapshotService.class);
    private final JwtVerifier verifier = mock(JwtVerifier.class);
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        ObjectMapper mapper = Jackson2ObjectMapperBuilder.json()
            .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
        mvc = MockMvcBuilders.standaloneSetup(new SimulationSnapshotAdminController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper))
            .addFilters(new AdminAuthFilter(mapper, verifier)).build();
        when(verifier.isDisabled()).thenReturn(true);
        when(verifier.developmentAuthContext()).thenReturn(new AuthContext("test@example.invalid", true, true));
    }

    @Test
    void mapsAllSixExplicitSelectionsAndReturnsTheServiceSnapshot() throws Exception {
        when(service.get("lol", CHOICE)).thenReturn(new SimulationSnapshotResponse("lol", CHOICE, null, null,
            List.of(), null, List.of(), "scene-digest", OffsetDateTime.parse("2026-10-01T00:00:00Z")));
        mvc.perform(request()).andExpect(status().isOk()).andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.selection.sourceLevel").value(1))
            .andExpect(jsonPath("$.selection.targetLevel").value(2))
            .andExpect(jsonPath("$.selection.basicAttackSkillKey").value("shared_basic_attack"))
            .andExpect(jsonPath("$.snapshotDigest").value("scene-digest"))
            .andExpect(jsonPath("$.readAt").isString());
        verify(service).get("lol", CHOICE);
        verifyNoMoreInteractions(service);
    }

    @Test
    void authenticationAndEditPermissionStillApply() throws Exception {
        when(verifier.isDisabled()).thenReturn(false);
        mvc.perform(request()).andExpect(status().isUnauthorized());
        when(verifier.verify("fixture")).thenReturn(new AuthContext("test@example.invalid", false, false));
        mvc.perform(request().header("Authorization", "Bearer fixture")).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void missingOrNonNumericSelectionIsRejectedBeforeServiceCall() throws Exception {
        mvc.perform(get(URL).param("sourceCharacterKey", "hero_a")).andExpect(status().isBadRequest());
        mvc.perform(get(URL).param("sourceCharacterKey", "hero_a").param("sourceLevel", "unknown")
            .param("targetCharacterKey", "hero_b").param("targetLevel", "2")
            .param("basicAttackSkillKey", "shared_basic_attack").param("basicAttackLevel", "1"))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void dependencyFailureReturnsItsFieldAndNoPartialSnapshot() throws Exception {
        when(service.get("lol", CHOICE)).thenThrow(new ApiException(HttpStatus.CONFLICT,
            "409.SIMULATION_SNAPSHOT_INVALID", "依赖缺失", Map.of("fieldIssues", List.of(
                Map.of("field", "skillConfigurations[0].effects.attack_hit.results[0].detail.damageTypeKey",
                    "code", "REFERENCE_MISSING")))));
        mvc.perform(request()).andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.SIMULATION_SNAPSHOT_INVALID"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("REFERENCE_MISSING"))
            .andExpect(jsonPath("$.source").doesNotExist()).andExpect(jsonPath("$.snapshotDigest").doesNotExist());
    }

    private MockHttpServletRequestBuilder request() {
        return get(URL).param("sourceCharacterKey", "hero_a").param("sourceLevel", "1")
            .param("targetCharacterKey", "hero_b").param("targetLevel", "2")
            .param("basicAttackSkillKey", "shared_basic_attack").param("basicAttackLevel", "1");
    }
}
