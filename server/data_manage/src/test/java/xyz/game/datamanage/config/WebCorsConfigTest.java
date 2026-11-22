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
import xyz.game.datamanage.controller.adminapi.image.ImageAdminController;
import xyz.game.datamanage.controller.publicapi.GamePublicController;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.image.ImageService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.maintenance.MaintenanceIngress;


@WebMvcTest(controllers = {GamePublicController.class, ImageAdminController.class})
@Import({xyz.game.datamanage.support.auth.AccountControllerTestConfig.class, WebCorsConfig.class, AdminAuthFilter.class})
class WebCorsConfigTest {

    private static final String ORIGIN = "https://localhost:5173";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GameDataService gameDataService;

    @MockitoBean
    private ImageService imageService;

    @MockitoBean
    private AdminEditLogHelper adminEditLogHelper;



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
    void maintenanceWriteDoesNotAdvertiseCorsOnThePublicConnector() throws Exception {
        mockMvc.perform(
            options("/api/admin/games/lol/images/icon")
                    .header(HttpHeaders.ORIGIN, ORIGIN)
                    .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "PUT")
                    .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "X-Damage-Client, Content-Type, If-None-Match")
            )
            .andExpect(status().isForbidden())
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    void privatePreviewDoesNotAdvertiseCorsEvenToTheConfiguredOrigin() throws Exception {
        mockMvc.perform(options("/internal/maintenance/games/lol/simulation-preview")
                .requestAttr(MaintenanceIngress.PRIVATE_CONNECTOR_ATTRIBUTE, true)
                .header(HttpHeaders.ORIGIN, ORIGIN)
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "X-Damage-Client, Content-Type"))
            .andExpect(status().isForbidden())
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    void publicReadPathDoesNotAdvertiseWildcardCorsOnThePrivateConnector() throws Exception {
        when(gameDataService.listGames()).thenReturn(JsonNodeFactory.instance.arrayNode());
        mockMvc.perform(get("/api/games").requestAttr(MaintenanceIngress.PRIVATE_CONNECTOR_ATTRIBUTE, true)
                .header(HttpHeaders.ORIGIN, ORIGIN).header("Sec-Fetch-Site", "same-origin"))
            .andExpect(status().isOk())
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }
}
