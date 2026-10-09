package xyz.game.datamanage.controller.adminapi.damagetype;

import static org.mockito.ArgumentMatchers.any;
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
import static xyz.game.datamanage.support.formula.DamageTypeFormulaFixtures.definition;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaReplaceRequest;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaResponse;
import xyz.game.datamanage.service.damagetype.DamageTypeService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = DamageTypeAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class DamageTypeFormulaAdminControllerTest {

    private static final String PATH = "/api/admin/games/lol/damage-types/physical/formula";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private DamageTypeService service;
    @MockitoBean private AdminEditLogHelper logHelper;
    @MockitoBean private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("admin@example.com", true, true));
    }

    @Test
    void getsPutsAndDeletesFormula() throws Exception {
        DamageTypeFormulaResponse response = new DamageTypeFormulaResponse(
            "lol",
            "physical",
            definition("1.00"),
            OffsetDateTime.parse("2026-09-27T08:00:00Z")
        );
        when(service.getFormula("lol", "physical")).thenReturn(response);
        when(service.replaceFormula(eq("lol"), eq("physical"), any(DamageTypeFormulaReplaceRequest.class)))
            .thenReturn(response);

        mockMvc.perform(get(PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.damageTypeKey").value("physical"))
            .andExpect(jsonPath("$.formula.stages[0].expression.op").value("const"))
            .andExpect(jsonPath("$.formula.stages[0].expression.value").value("1.00"));

        mockMvc.perform(put(PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"formula":{"inputs":[],"stages":[{"key":"x","name":"倍率","expression":{"op":"const","value":"1"}}],"outputStageKey":"x"}}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.damageTypeKey").value("physical"));

        mockMvc.perform(delete(PATH)).andExpect(status().isNoContent());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void missingFormulaAndUnboundBodyUseStableCodes() throws Exception {
        when(service.getFormula("lol", "physical")).thenThrow(new ApiException(
            HttpStatus.NOT_FOUND,
            "404.DAMAGE_TYPE_FORMULA_NOT_FOUND",
            "伤害类型结算公式未配置"
        ));

        mockMvc.perform(get(PATH))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("404.DAMAGE_TYPE_FORMULA_NOT_FOUND"));

        mockMvc.perform(put(PATH).contentType(MediaType.APPLICATION_JSON).content("{"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        mockMvc.perform(put(PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"formula\":{},\"formulaConfigured\":true}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        mockMvc.perform(post("/api/admin/games/lol/damage-types")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"damageTypeKey":"physical","name":"物理","status":"ENABLED","sortOrder":1,"formulaConfigured":true}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        mockMvc.perform(put("/api/admin/games/lol/damage-types/physical")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"物理","status":"ENABLED","sortOrder":1,"calculationFormula":{}}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        verify(service, never()).replaceFormula(any(), any(), any());
        verify(service, never()).create(any(), any());
        verify(service, never()).update(any(), any(), any());
    }
}
