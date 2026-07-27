package xyz.game.datamanage.controller.adminapi.combatdata;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.service.combatdata.ability.DirectDamageAbilitySetupService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;

@WebMvcTest(controllers = CombatDataDirectDamageAbilitySetupAdminController.class)
@Import({AdminAuthFilter.class, xyz.game.datamanage.support.error.GlobalExceptionHandler.class})
class CombatDataDirectDamageAbilitySetupAdminControllerMockMvcTest {

    private static final String PATH =
        "/api/admin/games/lol/combat-data/providers/provider_q/abilities/ability_q:direct-damage-setup";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DirectDamageAbilitySetupService service;
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
    void putDirectDamageSetupReturnsAggregateAndLogs() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.put("providerId", "provider_q");
        response.put("abilityId", "ability_q");
        response.put("currentRevision", 43);
        response.putObject("ability")
            .put("abilityId", "ability_q")
            .put("providerId", "provider_q")
            .put("abilityKindTypeId", 1);
        response.putObject("phase").put("phaseId", "phase_q").put("phaseTypeId", 2);
        response.putObject("effectSequence").put("sequenceId", "seq_q");
        response.putObject("effectStep")
            .put("stepId", "step_q")
            .put("operationTypeId", 10)
            .put("targetSelectorTypeId", 20)
            .putObject("damageDetail")
            .put("amountFormulaKey", "amt")
            .put("damageTypeId", 1)
            .put("valuePolicyTypeId", 2)
            .put("copyableOnHit", false)
            .put("critEligible", false);
        response.putObject("phaseEffectSequenceBinding")
            .put("phaseId", "phase_q")
            .put("triggerTypeId", 5)
            .put("sequenceId", "seq_q");
        when(service.putDirectDamageSetup(eq("lol"), eq("provider_q"), eq("ability_q"), any()))
            .thenReturn(response);

        mockMvc.perform(
                put(PATH)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(validRequestJson())
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.providerId").value("provider_q"))
            .andExpect(jsonPath("$.abilityId").value("ability_q"))
            .andExpect(jsonPath("$.currentRevision").value(43))
            .andExpect(jsonPath("$.ability.abilityKindTypeId").value(1))
            .andExpect(jsonPath("$.phase.phaseTypeId").value(2))
            .andExpect(jsonPath("$.effectStep.operationTypeId").value(10))
            .andExpect(jsonPath("$.effectStep.targetSelectorTypeId").value(20))
            .andExpect(jsonPath("$.effectStep.damageDetail.damageTypeId").value(1))
            .andExpect(jsonPath("$.effectStep.damageDetail.valuePolicyTypeId").value(2))
            .andExpect(jsonPath("$.phaseEffectSequenceBinding.triggerTypeId").value(5));

        verify(service).putDirectDamageSetup(eq("lol"), eq("provider_q"), eq("ability_q"), any());
        verify(adminEditLogHelper).log(any(), any(), any(), eq(200));
    }

    @Test
    void putDirectDamageSetupRequiresAuthWhenJwtEnabled() throws Exception {
        when(jwtVerifier.isDisabled()).thenReturn(false);

        mockMvc.perform(
                put(PATH)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(validRequestJson())
            )
            .andExpect(status().isUnauthorized());

        verify(service, never()).putDirectDamageSetup(any(), any(), any(), any());
        verify(adminEditLogHelper, never()).log(any(), any(), any(), eq(200));
    }

    @Test
    void putDirectDamageSetupReturns400OnInvalidDetail() throws Exception {
        when(service.putDirectDamageSetup(eq("lol"), eq("provider_q"), eq("ability_q"), any()))
            .thenThrow(
                new ApiException(
                    org.springframework.http.HttpStatus.BAD_REQUEST,
                    "400.INVALID_BODY",
                    "effectStep must include exactly damageDetail",
                    Map.of("path", "/effectStep", "reason", "multiple details")
                )
            );

        mockMvc.perform(
                put(PATH)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "expectedCurrentRevision":42,
                          "ability":{
                            "abilityId":"ability_q","providerId":"provider_q",
                            "abilityKey":"q","abilityKindTypeId":1,"displayName":"Q"
                          },
                          "phase":{
                            "phaseId":"phase_q","abilityId":"ability_q",
                            "phaseOrder":0,"phaseTypeId":2
                          },
                          "effectSequence":{
                            "sequenceId":"seq_q","providerId":"provider_q","sequenceKey":"seq_key"
                          },
                          "effectStep":{
                            "stepId":"step_q","sequenceId":"seq_q","stepOrder":0,
                            "operationTypeId":10,"targetSelectorTypeId":20,
                            "damageDetail":{"amountFormulaKey":"amt","damageTypeId":1,"valuePolicyTypeId":2},
                            "healDetail":{"amountFormulaKey":"h","valuePolicyTypeId":1}
                          },
                          "phaseEffectSequenceBinding":{
                            "phaseId":"phase_q","triggerTypeId":5,"sequenceId":"seq_q"
                          }
                        }
                        """)
            )
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        verify(adminEditLogHelper, never()).log(any(), any(), any(), eq(200));
    }

    @Test
    void putDirectDamageSetupReturns409OnRevisionConflict() throws Exception {
        when(service.putDirectDamageSetup(eq("lol"), eq("provider_q"), eq("ability_q"), any()))
            .thenThrow(
                new ApiException(
                    org.springframework.http.HttpStatus.CONFLICT,
                    "409.REVISION_CONFLICT",
                    "expectedCurrentRevision does not match current revision",
                    Map.of("expectedCurrentRevision", 42L, "actualCurrentRevision", 99L)
                )
            );

        mockMvc.perform(
                put(PATH)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(validRequestJson())
            )
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.REVISION_CONFLICT"))
            .andExpect(jsonPath("$.error.details.expectedCurrentRevision").value(42))
            .andExpect(jsonPath("$.error.details.actualCurrentRevision").value(99));

        verify(adminEditLogHelper, never()).log(any(), any(), any(), eq(200));
    }

    private static String validRequestJson() {
        return """
            {
              "expectedCurrentRevision":42,
              "ability":{
                "abilityId":"ability_q","providerId":"provider_q",
                "abilityKey":"q","abilityKindTypeId":1,"displayName":"Q"
              },
              "phase":{
                "phaseId":"phase_q","abilityId":"ability_q",
                "phaseOrder":0,"phaseTypeId":2
              },
              "effectSequence":{
                "sequenceId":"seq_q","providerId":"provider_q","sequenceKey":"seq_key"
              },
              "effectStep":{
                "stepId":"step_q","sequenceId":"seq_q","stepOrder":0,
                "operationTypeId":10,"targetSelectorTypeId":20,
                "damageDetail":{"amountFormulaKey":"amt","damageTypeId":1,"valuePolicyTypeId":2}
              },
              "phaseEffectSequenceBinding":{
                "phaseId":"phase_q","triggerTypeId":5,"sequenceId":"seq_q"
              }
            }
            """;
    }
}
