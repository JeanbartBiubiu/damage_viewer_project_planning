package xyz.game.datamanage.config;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.notNullValue;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.controller.adminapi.VersionAdminController;
import xyz.game.datamanage.controller.publicapi.GamePublicController;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.combatdata.revision.CombatDataPublishService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = {GamePublicController.class, VersionAdminController.class})
@Import({WebCorsConfig.class, AdminAuthFilter.class})
class WebCorsConfigTest {

    private static final String ORIGIN = "http://localhost:5173";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GameDataService gameDataService;

    @MockitoBean
    private CombatDataPublishService combatDataPublishService;

    @MockitoBean
    private AdminEditLogHelper adminEditLogHelper;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @Test
    void publicGetResponseExposesEtagForCrossOriginFetch() throws Exception {
        when(gameDataService.listGames()).thenReturn(JsonNodeFactory.instance.arrayNode());

        mockMvc.perform(get("/api/games").header(HttpHeaders.ORIGIN, ORIGIN))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "*"))
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS, containsString(HttpHeaders.ETAG)))
            .andExpect(header().string(HttpHeaders.ETAG, notNullValue()));
    }

    @Test
    void adminPreflightRequestPassesWithoutAuthorization() throws Exception {
        mockMvc.perform(
            options("/api/admin/games/lol/versions:publish")
                    .header(HttpHeaders.ORIGIN, ORIGIN)
                    .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Authorization, Content-Type, If-None-Match")
            )
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "*"))
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS, containsString("POST")))
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS, containsString("If-None-Match")));
    }
}
