package xyz.game.datamanage.controller.adminapi;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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

@WebMvcTest(controllers = VersionAdminController.class)
@Import(AdminAuthFilter.class)
class VersionAdminControllerMockMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GameDataService gameDataService;

    @MockitoBean
    private AdminEditLogHelper adminEditLogHelper;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @BeforeEach
    void stubAuthDisabled() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext()).thenReturn(new AuthContext("dev@example.com", true, true));
    }

    @Test
    void publishVersionDelegatesToGameDataServiceAndLogs() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.put("versionCode", "14.1");
        response.put("releaseDate", "2026-07-12");
        response.put("changeRevision", 7);
        response.put("publishedAt", "2026-07-12T00:00:00Z");
        response.put("updatedAt", "2026-07-12T00:00:00Z");
        when(gameDataService.publishVersion(eq("lol"), any())).thenReturn(response);

        mockMvc.perform(
                post("/api/admin/games/lol/versions:publish")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"versionCode\":\"14.1\",\"releaseDate\":\"2026-07-12\"}")
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.versionCode").value("14.1"))
            .andExpect(jsonPath("$.changeRevision").value(7))
            .andExpect(jsonPath("$.releaseDate").value("2026-07-12"))
            .andExpect(jsonPath("$.publishedAt").value("2026-07-12T00:00:00Z"))
            .andExpect(jsonPath("$.updatedAt").value("2026-07-12T00:00:00Z"));

        verify(gameDataService).publishVersion(eq("lol"), any());
        verify(adminEditLogHelper).log(any(), any(), any(), eq(200));
    }
}
