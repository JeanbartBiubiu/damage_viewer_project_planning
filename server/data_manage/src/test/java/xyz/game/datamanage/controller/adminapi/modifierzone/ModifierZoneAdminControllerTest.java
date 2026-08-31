package xyz.game.datamanage.controller.adminapi.modifierzone;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.modifierzone.ModifierZoneApplicationStage;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCreateRequest;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneListQuery;
import xyz.game.datamanage.model.modifierzone.ModifierZoneListResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;
import xyz.game.datamanage.service.modifierzone.ModifierZoneService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = ModifierZoneAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class ModifierZoneAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/modifier-zones";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private ModifierZoneService service;
    @MockitoBean private AdminEditLogHelper logHelper;
    @MockitoBean private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("admin@example.com", true, true));
    }

    @Test
    void listsCreatesAndDeletesWithStableContract() throws Exception {
        ModifierZoneResponse response = response();
        when(service.list(eq("lol"), any(ModifierZoneListQuery.class)))
            .thenReturn(new ModifierZoneListResponse(List.of(response), 1));
        when(service.create(eq("lol"), any(ModifierZoneCreateRequest.class))).thenReturn(response);

        mockMvc.perform(get(BASE_PATH).queryParam("domain", "DAMAGE"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].modifierZoneKey").value("damage_pre_defense"));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"modifierZoneKey":"damage_pre_defense","name":"伤害前修正","domain":"DAMAGE","calculationMode":"RATIO_ADD","applicationStage":"DAMAGE_PRE_DEFENSE","description":null,"status":"ENABLED","sortOrder":0}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.domain").value("DAMAGE"));

        mockMvc.perform(delete(BASE_PATH + "/damage_pre_defense"))
            .andExpect(status().isNoContent());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    private static ModifierZoneResponse response() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-31T00:00:00Z");
        return new ModifierZoneResponse(
            "lol", "damage_pre_defense", "伤害前修正",
            ModifierZoneDomain.DAMAGE, ModifierZoneCalculationMode.RATIO_ADD,
            ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE, null,
            ModifierZoneStatus.ENABLED, 0, timestamp, timestamp
        );
    }
}
