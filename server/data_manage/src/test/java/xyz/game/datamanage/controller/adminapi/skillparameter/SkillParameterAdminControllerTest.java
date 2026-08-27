package xyz.game.datamanage.controller.adminapi.skillparameter;

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
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.skillparameter.SkillParameterCreateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.service.skillparameter.SkillParameterService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillParameterAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillParameterAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skills/ezreal_q/parameters";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillParameterService service;
    @MockitoBean private AdminEditLogHelper logHelper;
    @MockitoBean private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("admin@example.com", true, true));
    }

    @Test
    void listsGetsCreatesUpdatesAndDeletesWithStatusesAndEditLogs() throws Exception {
        SkillParameterResponse response = response();
        when(service.list("lol", "ezreal_q")).thenReturn(List.of(response));
        when(service.get("lol", "ezreal_q", "base_damage")).thenReturn(response);
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillParameterCreateRequest.class)))
            .thenReturn(response);
        when(service.update(
            eq("lol"), eq("ezreal_q"), eq("base_damage"), any(SkillParameterUpdateRequest.class)
        )).thenReturn(response);

        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].parameterKey").value("base_damage"))
            .andExpect(jsonPath("$[0].levelValues.1").value(20));

        mockMvc.perform(get(BASE_PATH + "/base_damage"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.skillKey").value("ezreal_q"))
            .andExpect(jsonPath("$.valueMode").value("SKILL_LEVEL"))
            .andExpect(jsonPath("$.fixedValue").value(nullValue()))
            .andExpect(jsonPath("$.levelValues.5").value(120));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"parameterKey":"base_damage","name":"基础伤害","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","fixedValue":null,"levelValues":{"1":20,"2":45,"3":70,"4":95,"5":120},"description":null,"sortOrder":10}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.parameterKey").value("base_damage"));

        mockMvc.perform(put(BASE_PATH + "/base_damage")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"基础伤害","valueType":"DECIMAL","valueMode":"SKILL_LEVEL","fixedValue":null,"levelValues":{"1":20,"2":45,"3":70,"4":95,"5":120},"description":null,"sortOrder":10}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sortOrder").value(10));

        mockMvc.perform(delete(BASE_PATH + "/base_damage"))
            .andExpect(status().isNoContent());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void missingParentReturns404ForListInsteadOfEmptyArray() throws Exception {
        when(service.list("lol", "ezreal_q")).thenThrow(new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_NOT_FOUND",
            "技能不存在",
            Map.of("skillKey", "ezreal_q")
        ));

        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("404.SKILL_NOT_FOUND"));
    }

    @Test
    void putParameterKeyIsRejectedAsImmutable() throws Exception {
        when(service.update(
            eq("lol"), eq("ezreal_q"), eq("base_damage"), any(SkillParameterUpdateRequest.class)
        )).thenThrow(new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.VALIDATION_FAILED",
            "技能参数不合法",
            Map.of(
                "fieldIssues",
                List.of(Map.of(
                    "field", "parameterKey",
                    "code", "IMMUTABLE",
                    "message", "参数标识不能修改"
                ))
            )
        ));

        mockMvc.perform(put(BASE_PATH + "/base_damage")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"parameterKey":"base_damage","name":"基础伤害","valueType":"DECIMAL","valueMode":"FIXED","fixedValue":1.3,"levelValues":null,"sortOrder":10}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void invalidEnumReturnsValidationFailedBeforeService() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"parameterKey":"base_damage","name":"基础伤害","valueType":"STRING","valueMode":"FIXED","fixedValue":1,"sortOrder":10}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));

        verify(service, never()).create(any(), any(), any());
    }

    private static SkillParameterResponse response() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        Map<String, BigDecimal> levels = new LinkedHashMap<>();
        levels.put("1", new BigDecimal("20"));
        levels.put("2", new BigDecimal("45"));
        levels.put("3", new BigDecimal("70"));
        levels.put("4", new BigDecimal("95"));
        levels.put("5", new BigDecimal("120"));
        return new SkillParameterResponse(
            "lol",
            "ezreal_q",
            "base_damage",
            "基础伤害",
            SkillParameterValueType.DECIMAL,
            SkillParameterValueMode.SKILL_LEVEL,
            null,
            levels,
            null,
            10,
            timestamp,
            timestamp
        );
    }
}
