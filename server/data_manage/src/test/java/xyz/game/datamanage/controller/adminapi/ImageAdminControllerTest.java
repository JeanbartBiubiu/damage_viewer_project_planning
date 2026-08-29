package xyz.game.datamanage.controller.adminapi;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = ImageAdminController.class)
@Import(AdminAuthFilter.class)
class ImageAdminControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GameDataService gameDataService;

    @MockitoBean
    private AdminEditLogHelper adminEditLogHelper;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("author@example.com", true, true));
    }

    @Test
    void putImageDelegatesToGameDataService() throws Exception {
        ObjectNode stored = JsonNodeFactory.instance.objectNode();
        stored.put("uri", "icon");
        stored.put("imageBase64", "data:image/png;base64,abc");
        when(gameDataService.upsertImage(eq("lol"), eq("icon"), any())).thenReturn(stored);

        mockMvc.perform(
                put("/api/admin/games/lol/images/icon")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"imageBase64\":\"data:image/png;base64,abc\"}")
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.uri").value("icon"));

        verify(gameDataService).upsertImage(eq("lol"), eq("icon"), any());
        verify(adminEditLogHelper).log(any(), any(), any(), eq(200));
    }
}
