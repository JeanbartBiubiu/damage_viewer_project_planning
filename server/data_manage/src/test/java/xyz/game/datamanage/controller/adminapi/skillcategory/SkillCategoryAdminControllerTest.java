package xyz.game.datamanage.controller.adminapi.skillcategory;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
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
import xyz.game.datamanage.model.skillcategory.SkillCategoryCreateRequest;
import xyz.game.datamanage.model.skillcategory.SkillCategoryListQuery;
import xyz.game.datamanage.model.skillcategory.SkillCategoryListResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryStatus;
import xyz.game.datamanage.service.skillcategory.SkillCategoryService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillCategoryAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillCategoryAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skill-categories";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillCategoryService service;
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
        SkillCategoryResponse response = response();
        when(service.list(eq("lol"), any(SkillCategoryListQuery.class)))
            .thenReturn(new SkillCategoryListResponse(List.of(response), 1));
        when(service.create(eq("lol"), any(SkillCategoryCreateRequest.class))).thenReturn(response);

        mockMvc.perform(get(BASE_PATH).queryParam("status", "ENABLED"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].skillCategoryKey").value("active"));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"skillCategoryKey":"active","name":"主动技能","description":null,"status":"ENABLED","sortOrder":10}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("ENABLED"));

        mockMvc.perform(delete(BASE_PATH + "/active"))
            .andExpect(status().isNoContent());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void invalidJsonEnumReturnsInvalidBodyBeforeService() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"skillCategoryKey":"active","name":"主动技能","status":"ARCHIVED","sortOrder":10}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        verify(service, never()).create(any(), any());
    }

    private static SkillCategoryResponse response() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-23T08:00:00Z");
        return new SkillCategoryResponse(
            "lol", "active", "主动技能", null, SkillCategoryStatus.ENABLED, 10, timestamp, timestamp
        );
    }
}
