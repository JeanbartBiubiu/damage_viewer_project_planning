package xyz.game.datamanage.controller.adminapi.combatdata;

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
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.service.combatdata.ability.AbilityCombatDataService;
import xyz.game.datamanage.service.combatdata.effect.EffectCombatDataService;
import xyz.game.datamanage.service.combatdata.entity.EntityCombatDataService;
import xyz.game.datamanage.service.combatdata.provider.ProviderCombatDataService;
import xyz.game.datamanage.service.combatdata.type.CombatTypeService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = {
    CombatDataEntityAdminController.class,
    CombatDataEffectAdminController.class,
    CombatDataTypeAdminController.class,
    CombatDataProviderAdminController.class,
    CombatDataAbilityAdminController.class
})
@Import({AdminAuthFilter.class, xyz.game.datamanage.support.error.GlobalExceptionHandler.class})
class CombatDataAdminControllerMockMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private EntityCombatDataService entityService;
    @MockitoBean
    private EffectCombatDataService effectService;
    @MockitoBean
    private CombatTypeService typeService;
    @MockitoBean
    private ProviderCombatDataService providerService;
    @MockitoBean
    private AbilityCombatDataService abilityService;
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
    void putEntityReturnsWriteObjectAndLogs() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("entityId", "e1");
        response.put("displayName", "Hero");
        response.put("currentRevision", 3);
        when(entityService.putEntity(eq("lol"), eq("e1"), any())).thenReturn(response);

        mockMvc.perform(
                put("/api/admin/games/lol/combat-data/entities/e1")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"displayName\":\"Hero\"}")
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.entityId").value("e1"))
            .andExpect(jsonPath("$.currentRevision").value(3));

        verify(adminEditLogHelper).log(any(), any(), any(), eq(200));
    }

    @Test
    void putEntityBatchReturnsAggregateAndLogs() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.put("entityId", "e1");
        response.put("displayName", "Example");
        response.put("currentRevision", 43);
        response.putArray("attributes");
        response.putArray("resources");
        response.putArray("providerMounts");
        when(entityService.putEntityBatch(eq("lol"), eq("e1"), any())).thenReturn(response);

        mockMvc.perform(
                put("/api/admin/games/lol/combat-data/entities/e1:batch")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "expectedCurrentRevision":42,
                          "displayName":"Example",
                          "attributes":[],
                          "resources":[],
                          "providerMounts":[]
                        }
                        """)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.entityId").value("e1"))
            .andExpect(jsonPath("$.currentRevision").value(43));

        verify(entityService).putEntityBatch(eq("lol"), eq("e1"), any());
        verify(adminEditLogHelper).log(any(), any(), any(), eq(200));
    }

    @Test
    void putEntityBatchReturns409OnRevisionConflict() throws Exception {
        when(entityService.putEntityBatch(eq("lol"), eq("e1"), any())).thenThrow(
            new xyz.game.datamanage.support.error.ApiException(
                org.springframework.http.HttpStatus.CONFLICT,
                "409.REVISION_CONFLICT",
                "expectedCurrentRevision does not match current revision",
                java.util.Map.of("expectedCurrentRevision", 42L, "actualCurrentRevision", 99L)
            )
        );

        mockMvc.perform(
                put("/api/admin/games/lol/combat-data/entities/e1:batch")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "expectedCurrentRevision":42,
                          "displayName":"Example"
                        }
                        """)
            )
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.REVISION_CONFLICT"))
            .andExpect(jsonPath("$.error.details.expectedCurrentRevision").value(42))
            .andExpect(jsonPath("$.error.details.actualCurrentRevision").value(99));

        verify(adminEditLogHelper, never()).log(any(), any(), any(), eq(200));
    }

    @Test
    void putEntityBatchRequiresAuthWhenJwtEnabled() throws Exception {
        when(jwtVerifier.isDisabled()).thenReturn(false);

        mockMvc.perform(
                put("/api/admin/games/lol/combat-data/entities/e1:batch")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"expectedCurrentRevision\":1,\"displayName\":\"Example\"}")
            )
            .andExpect(status().isUnauthorized());

        verify(entityService, never()).putEntityBatch(any(), any(), any());
    }

    @Test
    void putEffectStepReturnsJoinedDto() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("stepId", "s1");
        response.put("currentRevision", 8);
        response.putObject("damageDetail")
            .put("amountFormulaKey", "amt")
            .put("copyableOnHit", false);
        when(effectService.putStep(eq("lol"), eq("s1"), any())).thenReturn(response);

        mockMvc.perform(
                put("/api/admin/games/lol/combat-data/effect-steps/s1")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "sequenceId":"seq",
                          "stepOrder":0,
                          "operationTypeId":1,
                          "targetSelectorTypeId":2,
                          "damageDetail":{"amountFormulaKey":"amt","damageTypeId":1,"valuePolicyTypeId":2}
                        }
                        """)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stepId").value("s1"))
            .andExpect(jsonPath("$.damageDetail.amountFormulaKey").value("amt"))
            .andExpect(jsonPath("$.damageDetail.copyableOnHit").value(false))
            .andExpect(jsonPath("$.currentRevision").value(8));
    }

    @Test
    void putEffectStepAcceptsRepeatDetailWithoutNewRoute() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("stepId", "s2");
        response.put("currentRevision", 9);
        response.putObject("repeatDetail")
            .put("repeatScopeTypeId", 20263)
            .put("repeatCount", 3)
            .put("repeatTag", "on-hit")
            .put("triggerStateKey", "stacks")
            .put("threshold", 3)
            .put("delayMs", 0);
        when(effectService.putStep(eq("lol"), eq("s2"), any())).thenReturn(response);

        mockMvc.perform(
                put("/api/admin/games/lol/combat-data/effect-steps/s2")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "sequenceId":"seq",
                          "stepOrder":0,
                          "operationTypeId":1,
                          "targetSelectorTypeId":2,
                          "repeatDetail":{
                            "repeatScopeTypeId":20263,
                            "repeatCount":3,
                            "repeatTag":"on-hit",
                            "triggerStateKey":"stacks",
                            "threshold":3
                          }
                        }
                        """)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.repeatDetail.repeatTag").value("on-hit"))
            .andExpect(jsonPath("$.repeatDetail.delayMs").value(0))
            .andExpect(jsonPath("$.currentRevision").value(9));
    }

    @Test
    void putEffectStepAcceptsRepeatDetailWithExplicitDelayMs() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("stepId", "s2b");
        response.put("currentRevision", 10);
        response.putObject("repeatDetail")
            .put("repeatScopeTypeId", 20263)
            .put("repeatCount", 1)
            .put("repeatTag", "dusk_and_dawn_delayed_on_hit")
            .put("triggerStateKey", "spellblade_icd")
            .put("threshold", 1)
            .put("delayMs", 200);
        when(effectService.putStep(eq("lol"), eq("s2b"), any())).thenReturn(response);

        mockMvc.perform(
                put("/api/admin/games/lol/combat-data/effect-steps/s2b")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "sequenceId":"seq",
                          "stepOrder":0,
                          "operationTypeId":1,
                          "targetSelectorTypeId":2,
                          "repeatDetail":{
                            "repeatScopeTypeId":20263,
                            "repeatCount":1,
                            "repeatTag":"dusk_and_dawn_delayed_on_hit",
                            "triggerStateKey":"spellblade_icd",
                            "threshold":1,
                            "delayMs":200
                          }
                        }
                        """)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.repeatDetail.delayMs").value(200))
            .andExpect(jsonPath("$.currentRevision").value(10));
    }

    @Test
    void putExecuteEffectDetailReturnsWriteObjectAndLogs() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("stepId", "s-exec");
        response.put("threshold", 0.05);
        response.put("currentRevision", 11);
        when(effectService.putExecuteEffectDetail(eq("lol"), eq("s-exec"), any())).thenReturn(response);

        mockMvc.perform(
                put("/api/admin/games/lol/combat-data/execute-effect-details/s-exec")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"threshold\":0.05}")
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stepId").value("s-exec"))
            .andExpect(jsonPath("$.threshold").value(0.05))
            .andExpect(jsonPath("$.currentRevision").value(11));

        verify(adminEditLogHelper).log(any(), any(), any(), eq(200));
    }

    @Test
    void deleteAndBatchRoutesAreAbsent() throws Exception {
        mockMvc.perform(delete("/api/admin/games/lol/combat-data/entities/e1"))
            .andExpect(result -> {
                int status = result.getResponse().getStatus();
                // No @DeleteMapping: Spring may return 405, or GlobalExceptionHandler maps it to 500.
                org.junit.jupiter.api.Assertions.assertTrue(
                    status == 405 || status == 500,
                    "DELETE must not succeed, status=" + status
                );
            });
        mockMvc.perform(
                post("/api/admin/games/lol/combat-data/entities:batch")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("[]")
            )
            .andExpect(status().isNotFound());
        verify(entityService, never()).putEntity(any(), any(), any());
    }

    @Test
    void getIsNotMappedOnAdminControllers() throws Exception {
        mockMvc.perform(get("/api/admin/games/lol/combat-data/entities"))
            .andExpect(status().isNotFound());
    }
}
