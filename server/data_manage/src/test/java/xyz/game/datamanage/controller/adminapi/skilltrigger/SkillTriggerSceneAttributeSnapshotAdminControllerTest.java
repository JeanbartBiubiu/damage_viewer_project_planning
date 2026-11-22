package xyz.game.datamanage.controller.adminapi.skilltrigger;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
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
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.maintenance.MaintenancePrincipal;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillTriggerRuleAdminController.class)
@Import({xyz.game.datamanage.support.auth.AccountControllerTestConfig.class, AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillTriggerSceneAttributeSnapshotAdminControllerTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private SkillTriggerRuleService service;
    @MockitoBean private AdminEditLogHelper logHelper;


    @BeforeEach void setUp() {
    }

    @Test void acceptsTheExtensionWithoutChangingTheExistingRequestOrResponseEnvelope() throws Exception {
        when(service.create(eq("game"), eq("authored_skill"), any())).thenAnswer(call -> {
            SkillTriggerRuleCreateRequest value = call.getArgument(2);
            return new SkillTriggerRuleDetailResponse(value.ruleKey(), value.name(), value.description(), value.sortOrder(),
                value.eventSource(), value.conditionGroups(), value.actions(), value.perTargetCooldown(), value.maxTriggersPerProcess(), value.oncePerUse());
        });
        mvc.perform(post("/api/admin/games/game/skills/authored_skill/trigger-rules").contentType(MediaType.APPLICATION_JSON)
                .content(request("{\"subject\":\"TARGET\",\"attributeKey\":\"authored_stat\",\"sources\":[\"EQUIPMENT_DIRECT\",\"CHARACTER_LEVEL\"]}")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.actions[0].runtimeInputBindings[0].sourceType").value("SCENE_ATTRIBUTE_SNAPSHOT"))
            .andExpect(jsonPath("$.actions[0].runtimeInputBindings[0].detail.subject").value("TARGET"))
            .andExpect(jsonPath("$.actions[0].runtimeInputBindings[0].detail.sources[0]").value("EQUIPMENT_DIRECT"))
            .andExpect(jsonPath("$.actions[0].runtimeInputBindings[0].detail.unknownFields").doesNotExist());
        verify(logHelper).log(any(MaintenancePrincipal.class), any(), any(JsonNode.class), eq(201));
    }

    @ParameterizedTest @ValueSource(strings = {
        "{\"subject\":0,\"attributeKey\":\"authored_stat\",\"sources\":[\"CHARACTER_LEVEL\"]}",
        "{\"subject\":\"CURRENT_TARGET\",\"attributeKey\":\"authored_stat\",\"sources\":[\"CHARACTER_LEVEL\"]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":42,\"sources\":[\"CHARACTER_LEVEL\"]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":\"CHARACTER_LEVEL\"}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[0]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[null]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[\"CURRENT_ATTRIBUTE\"]}"
    })
    void rejectsCoercionAndUnspecifiedSourceKindsBeforeCallingTheService(String detail) throws Exception {
        mvc.perform(post("/api/admin/games/game/skills/authored_skill/trigger-rules").contentType(MediaType.APPLICATION_JSON).content(request(detail)))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        verify(service, never()).create(any(), any(), any());
        verifyNoInteractions(logHelper);
    }

    private static String request(String detail) {
        return """
            {"ruleKey":"start_rule","name":"启动","sortOrder":0,
             "eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"authored_skill","useKind":"ACTIVE","castPhase":"INITIAL"}},
             "conditionGroups":[],"actions":[{"actionKey":"start","name":"启动","actionType":"START_PROCESS","sortOrder":0,
              "targetContext":"CURRENT_TARGET","detail":{"processKey":"authored_process"},
              "runtimeInputBindings":[{"bindingKey":"snapshot","parameterKey":"input","sourceType":"SCENE_ATTRIBUTE_SNAPSHOT","detail":%s}],
              "resultModifiers":[]}]}
            """.formatted(detail);
    }
}
