package xyz.game.datamanage.controller.adminapi.skill;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import xyz.game.datamanage.model.skill.SkillCreateRequest;
import xyz.game.datamanage.model.skill.SkillListQuery;
import xyz.game.datamanage.model.skill.SkillListResponse;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skill.SkillUpdateRequest;
import xyz.game.datamanage.service.skill.SkillService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skills";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillService service;
    @MockitoBean private AdminEditLogHelper logHelper;
    @MockitoBean private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("admin@example.com", true, true));
    }

    @Test
    void listsGetsCreatesUpdatesAndDeletesWithFullResponseAndEditLogs() throws Exception {
        SkillResponse response = response();
        when(service.list(eq("lol"), any(SkillListQuery.class)))
            .thenReturn(new SkillListResponse(List.of(response), 1));
        when(service.get("lol", "ezreal_q")).thenReturn(response);
        when(service.create(eq("lol"), any(SkillCreateRequest.class))).thenReturn(response);
        when(service.update(eq("lol"), eq("ezreal_q"), any(SkillUpdateRequest.class))).thenReturn(response);

        mockMvc.perform(get(BASE_PATH).queryParam("status", "ENABLED"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].skillKey").value("ezreal_q"))
            .andExpect(jsonPath("$.items[0].skillCategoryKeys[0]").value("active"));

        mockMvc.perform(get(BASE_PATH + "/ezreal_q"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.skillKey").value("ezreal_q"))
            .andExpect(jsonPath("$.name").value("秘术射击"))
            .andExpect(jsonPath("$.description").value(nullValue()))
            .andExpect(jsonPath("$.maxLevel").value(5))
            .andExpect(jsonPath("$.status").value("ENABLED"))
            .andExpect(jsonPath("$.sortOrder").value(10))
            .andExpect(jsonPath("$.skillCategoryKeys[0]").value("active"))
            .andExpect(jsonPath("$.skillCategoryKeys[1]").value("single_target"));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"skillKey":"ezreal_q","name":"秘术射击","description":null,"maxLevel":5,"status":"ENABLED","sortOrder":10,"skillCategoryKeys":["active","single_target"]}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.skillKey").value("ezreal_q"))
            .andExpect(jsonPath("$.maxLevel").value(5))
            .andExpect(jsonPath("$.skillCategoryKeys[1]").value("single_target"));

        mockMvc.perform(put(BASE_PATH + "/ezreal_q")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"秘术射击","description":null,"maxLevel":5,"status":"ENABLED","sortOrder":10,"skillCategoryKeys":["active","single_target"]}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ENABLED"));

        mockMvc.perform(delete(BASE_PATH + "/ezreal_q"))
            .andExpect(status().isNoContent());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void invalidJsonEnumReturnsInvalidBodyBeforeService() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"skillKey":"ezreal_q","name":"秘术射击","maxLevel":5,"status":"ARCHIVED","sortOrder":10,"skillCategoryKeys":[]}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        verify(service, never()).create(any(), any());
    }

    @Test
    void putSkillKeyIsRejectedAsImmutable() throws Exception {
        mockMvc.perform(put(BASE_PATH + "/ezreal_q")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"skillKey":"ezreal_q","name":"秘术射击","maxLevel":5,"status":"ENABLED","sortOrder":10,"skillCategoryKeys":[]}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));

        verify(service, never()).update(any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    private static SkillResponse response() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillResponse(
            "lol",
            "ezreal_q",
            "秘术射击",
            null,
            5,
            SkillStatus.ENABLED,
            10,
            List.of("active", "single_target"),
            timestamp,
            timestamp
        );
    }
}
