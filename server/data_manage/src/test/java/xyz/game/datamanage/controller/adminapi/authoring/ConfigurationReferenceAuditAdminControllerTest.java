package xyz.game.datamanage.controller.adminapi.authoring;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse.Counts;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse.Issue;
import xyz.game.datamanage.service.authoring.ConfigurationReferenceAuditService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

class ConfigurationReferenceAuditAdminControllerTest {
    private static final String URL = "/api/admin/games/lol/configuration-reference-audit";
    private final ConfigurationReferenceAuditService service = mock(ConfigurationReferenceAuditService.class);
    private final JwtVerifier verifier = mock(JwtVerifier.class);
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.standaloneSetup(new ConfigurationReferenceAuditAdminController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new AdminAuthFilter(new ObjectMapper(), verifier)).build();
        when(verifier.isDisabled()).thenReturn(true);
        when(verifier.developmentAuthContext()).thenReturn(new AuthContext("test@example.invalid", true, true));
    }

    @Test
    void returnsFrozenCountsAndFlatFullReferenceLocationWithoutSourceJson() throws Exception {
        when(service.audit("lol")).thenReturn(new ConfigurationReferenceAuditResponse("lol", true, false, 1, 1, 1, false,
            new Counts(1, 0, 1, 1), List.of(new Issue("INDEX_MISSING", "缺少配置引用索引", "lol", "skill", "EFFECT", "effect",
                "results[0].detail.damageTypeKey", "DAMAGE_TYPE", "", "physical", ""))));
        mvc.perform(get(URL)).andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.complete").value(true)).andExpect(jsonPath("$.healthy").value(false))
            .andExpect(jsonPath("$.observedIssueCount").value(1)).andExpect(jsonPath("$.totalIssueCount").value(1))
            .andExpect(jsonPath("$.returnedIssueCount").value(1)).andExpect(jsonPath("$.truncated").value(false))
            .andExpect(jsonPath("$.counts.sourceCount").value(1)).andExpect(jsonPath("$.counts.existingReferenceCount").value(0))
            .andExpect(jsonPath("$.counts.catalogTargetCount").value(1)).andExpect(jsonPath("$.counts.extractedReferenceCount").value(1))
            .andExpect(jsonPath("$.issues[0].code").value("INDEX_MISSING"))
            .andExpect(jsonPath("$.issues[0].sourceSkillKey").value("skill"))
            .andExpect(jsonPath("$.issues[0].sourceType").value("EFFECT"))
            .andExpect(jsonPath("$.issues[0].sourceKey").value("effect"))
            .andExpect(jsonPath("$.issues[0].fieldPath").value("results[0].detail.damageTypeKey"))
            .andExpect(jsonPath("$.issues[0].targetType").value("DAMAGE_TYPE"))
            .andExpect(jsonPath("$.issues[0].targetSkillKey").value(""))
            .andExpect(jsonPath("$.issues[0].targetKey").value("physical"))
            .andExpect(jsonPath("$.issues[0].targetSubKey").value(""))
            .andExpect(jsonPath("$.issues[0].data").doesNotExist());
        verify(service).audit("lol");
        verifyNoMoreInteractions(service);
    }

    @Test
    void partialReportPreservesUnknownTotalsAsNull() throws Exception {
        when(service.audit("lol")).thenReturn(new ConfigurationReferenceAuditResponse("lol", false, false, 1, null, 1, false,
            new Counts(5001, 10, 1, null), List.of(new Issue("AUDIT_LIMIT_EXCEEDED", "源对象数量超过审计上限", "lol",
                null, null, null, null, null, null, null, null))));
        mvc.perform(get(URL)).andExpect(status().isOk()).andExpect(jsonPath("$.complete").value(false))
            .andExpect(jsonPath("$.healthy").value(false)).andExpect(jsonPath("$.totalIssueCount").isEmpty())
            .andExpect(jsonPath("$.counts.extractedReferenceCount").isEmpty());
    }

    @Test
    void stillRequiresManagementAuthenticationAndPermission() throws Exception {
        when(verifier.isDisabled()).thenReturn(false);
        mvc.perform(get(URL)).andExpect(status().isUnauthorized());
        when(verifier.verify("fixture")).thenReturn(new AuthContext("test@example.invalid", false, false));
        mvc.perform(get(URL).header("Authorization", "Bearer fixture")).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void unknownGameAndReadFailureKeepErrorModelAndThereIsNoWriteRoute() throws Exception {
        when(service.audit("lol")).thenThrow(new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在"));
        mvc.perform(get(URL)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("404.GAME_NOT_FOUND"));
        doThrow(new IllegalStateException("test read failure")).when(service).audit("lol");
        mvc.perform(get(URL)).andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.error.code").value("500.INTERNAL_ERROR")).andExpect(jsonPath("$.healthy").doesNotExist());
        mvc.perform(post(URL)).andExpect(status().isMethodNotAllowed());
    }
}
