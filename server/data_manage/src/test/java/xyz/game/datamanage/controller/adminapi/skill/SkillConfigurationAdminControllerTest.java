package xyz.game.datamanage.controller.adminapi.skill;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest;
import xyz.game.datamanage.service.skillconfiguration.SkillConfigurationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillConfigurationAdminController.class)
@Import({xyz.game.datamanage.support.auth.AccountControllerTestConfig.class, AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillConfigurationAdminControllerTest {

    private static final String PATH = "/api/admin/games/lol/skills/ezreal_q/configuration";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillConfigurationService service;
    @MockitoBean private AdminEditLogHelper logHelper;

    @Test
    void routesReadCreateAndPatchAndKeepsFullResponseShape() throws Exception {
        var response = response();
        when(service.get("lol", "ezreal_q")).thenReturn(response);
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillConfigurationSaveRequest.class)))
            .thenReturn(response);
        when(service.update(eq("lol"), eq("ezreal_q"), any(SkillConfigurationSaveRequest.class)))
            .thenReturn(response);

        mockMvc.perform(get(PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.skill.skillKey").value("ezreal_q"))
            .andExpect(jsonPath("$.parameters").isArray())
            .andExpect(jsonPath("$.formulas").isArray())
            .andExpect(jsonPath("$.effects").isArray())
            .andExpect(jsonPath("$.processes").isArray())
            .andExpect(jsonPath("$.internalStates").isArray())
            .andExpect(jsonPath("$.triggerRules").isArray())
            .andExpect(jsonPath("$.baseDigest").value("digest"));
        mockMvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).content("""
            {"skill":{"name":"秘术射击","description":null,"maxLevel":5,"status":"ENABLED","sortOrder":10,
                      "skillCategoryKeys":[]},"changes":[]}
            """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.skill.maxLevel").value(5));
        mockMvc.perform(patch(PATH).contentType(MediaType.APPLICATION_JSON).content("""
            {"baseDigest":"digest","changes":[]}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.baseDigest").value("digest"));

        verify(logHelper).log(any(AuthContext.class), any(), any(), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(), eq(200));
    }

    @Test
    void rejectsUnknownSaveAndChangeFieldsBeforeCallingService() throws Exception {
        mockMvc.perform(patch(PATH).contentType(MediaType.APPLICATION_JSON).content("""
            {"baseDigest":"digest","changes":[],"effects":[]}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        mockMvc.perform(patch(PATH).contentType(MediaType.APPLICATION_JSON).content("""
            {"baseDigest":"digest","changes":[{"objectType":"EFFECT","operation":"DELETE",
              "key":"old_effect","value":null,"effectKey":"other_effect"}]}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        org.mockito.Mockito.verifyNoInteractions(service);
    }

    private static SkillConfigurationResponse response() {
        OffsetDateTime time = OffsetDateTime.parse("2026-09-01T00:00:00Z");
        SkillResponse skill = new SkillResponse("lol", "ezreal_q", "秘术射击", null, 5,
            SkillStatus.ENABLED, 10, List.of(), time, time);
        return new SkillConfigurationResponse(skill, List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), "digest");
    }
}
