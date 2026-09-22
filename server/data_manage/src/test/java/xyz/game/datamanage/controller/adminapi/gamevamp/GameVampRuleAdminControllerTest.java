package xyz.game.datamanage.controller.adminapi.gamevamp;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.service.gamevamp.GameVampRuleService;
import xyz.game.datamanage.support.auth.*;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = GameVampRuleAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class GameVampRuleAdminControllerTest {
    private static final String PATH = "/api/admin/games/lol/vamp-rules";
    @Autowired private MockMvc mvc;
    @MockitoBean private GameVampRuleService service;
    @MockitoBean private AdminEditLogHelper logs;
    @MockitoBean private JwtVerifier auth;

    @BeforeEach void enableDevelopmentAdmin() {
        when(auth.isDisabled()).thenReturn(true);
        when(auth.developmentAuthContext()).thenReturn(new AuthContext("admin@example.com", true, true));
    }

    @Test void getsAndReplacesCompleteCollection() throws Exception {
        when(service.get("lol")).thenReturn(new GameVampRules(List.of()));
        when(service.replace(eq("lol"), any())).thenAnswer(invocation -> invocation.getArgument(1));
        mvc.perform(get(PATH)).andExpect(status().isOk()).andExpect(jsonPath("$.rules").isEmpty());
        mvc.perform(put(PATH).contentType(MediaType.APPLICATION_JSON).content("""
            {"rules":[{"vampType":"OMNIVAMP","sourceAttributeKey":"omnivamp_percent","basisOutputKind":"POST_DEFENSE_DAMAGE",
            "defaultEfficiency":0,"deliveryKinds":["SKILL"],"originKinds":["DIRECT"],"skillCategoryKeys":["common"]}]}
            """)).andExpect(status().isOk()).andExpect(jsonPath("$.rules[0].defaultEfficiency").value(0))
            .andExpect(jsonPath("$.rules[0].vampType").value("OMNIVAMP"));
        verify(logs).log(any(), any(), any(), eq(200));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"rules\":[],\"oldRules\":[]}", "{\"rules\":[{\"vampType\":\"UNKNOWN\"}]}",
        "{\"rules\":[{\"unexpected\":0}]}", "{\"rules\":[{\"defaultEfficiency\":\"NaN\"}]}"})
    void rejectsUnknownFieldsEnumsAndNonFiniteValuesBeforeService(String body) throws Exception {
        mvc.perform(put(PATH).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        verify(service, never()).replace(any(), any());
    }
}
