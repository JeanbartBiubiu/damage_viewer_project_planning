package xyz.game.datamanage.controller.adminapi.skilltrigger;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageDeliveryKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageOriginKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLinkEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleSummaryResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleUpdateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillTriggerRuleAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillTriggerRuleAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skills/ezreal_q/trigger-rules";
    private static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-29T00:00:00Z");

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillTriggerRuleService service;
    @MockitoBean private AdminEditLogHelper logHelper;
    @MockitoBean private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("admin@example.com", true, true));
    }

    @Test
    void listsGetsCreatesUpdatesAndDeletesWithStatusesAndOneEditLogEach() throws Exception {
        when(service.list("lol", "ezreal_q")).thenReturn(List.of(summary()));
        when(service.get("lol", "ezreal_q", "on_hit")).thenReturn(detail());
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillTriggerRuleCreateRequest.class))).thenReturn(detail());
        when(service.update(eq("lol"), eq("ezreal_q"), eq("on_hit"), any(SkillTriggerRuleUpdateRequest.class)))
            .thenReturn(detail());

        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].ruleKey").value("on_hit"))
            .andExpect(jsonPath("$[0].eventType").value("BASIC_ATTACK_HIT"))
            .andExpect(jsonPath("$[0].actionCount").value(1))
            .andExpect(jsonPath("$[0].actions").doesNotExist());

        mockMvc.perform(get(BASE_PATH + "/on_hit"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ruleKey").value("on_hit"))
            .andExpect(jsonPath("$.eventSource.eventType").value("BASIC_ATTACK_HIT"))
            .andExpect(jsonPath("$.actions[0].detail.effectKey").value("burst"));

        mockMvc.perform(post(BASE_PATH).contentType(MediaType.APPLICATION_JSON).content(createJson()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.ruleKey").value("on_hit"));

        mockMvc.perform(put(BASE_PATH + "/on_hit").contentType(MediaType.APPLICATION_JSON).content(updateJson()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ruleKey").value("on_hit"));

        mockMvc.perform(delete(BASE_PATH + "/on_hit"))
            .andExpect(status().isNoContent())
            .andExpect(jsonPath("$").doesNotExist());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void missingParentReturns404AndDoesNotWriteEditLog() throws Exception {
        when(service.list("lol", "ezreal_q")).thenThrow(new ApiException(
            HttpStatus.NOT_FOUND, "404.SKILL_NOT_FOUND", "技能不存在", Map.of("skillKey", "ezreal_q")
        ));
        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("404.SKILL_NOT_FOUND"));
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void putRuleKeyMismatchAndServiceFailureDoNotWriteEditLog() throws Exception {
        when(service.update(eq("lol"), eq("ezreal_q"), eq("on_hit"), any(SkillTriggerRuleUpdateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "请求校验失败",
                Map.of("fieldIssues", List.of(Map.of("field", "ruleKey", "code", "IMMUTABLE")))
            ));
        mockMvc.perform(put(BASE_PATH + "/on_hit")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "ruleKey":"other",
                      "name":"命中追加",
                      "sortOrder":10,
                      "eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},
                      "conditionGroups":[],
                      "actions":[{
                        "actionKey":"deal","name":"执行效果","actionType":"EXECUTE_EFFECT","sortOrder":10,
                        "targetContext":"CURRENT_TARGET","detail":{"effectKey":"burst"},
                        "runtimeInputBindings":[],"resultModifiers":[]
                      }]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));

        when(service.update(eq("lol"), eq("ezreal_q"), eq("on_hit"), any(SkillTriggerRuleUpdateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "请求校验失败",
                Map.of("fieldIssues", List.of(Map.of("field", "actions", "code", "FAIL_PROCESS_NOT_LAST")))
            ));
        mockMvc.perform(put(BASE_PATH + "/on_hit").contentType(MediaType.APPLICATION_JSON).content(updateJson()))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void invalidCreateBodyReturns400BeforeServiceAndDoesNotWriteEditLog() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "ruleKey":"on_hit",
                      "name":"命中追加",
                      "sortOrder":10,
                      "eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},
                      "conditionGroups":[],
                      "actions":[]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));
        verify(service, never()).create(any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void damageEventDetailBindsAndSerializesWithExplicitFilters() throws Exception {
        SkillTriggerRuleDetailResponse response = new SkillTriggerRuleDetailResponse(
            "on_damage_taken",
            "受到伤害",
            null,
            10,
            new SkillTriggerEventSource(
                SkillTriggerEventType.DAMAGE_TAKEN,
                new SkillTriggerDamageEventDetail(
                    "physical",
                    SkillTriggerDamageDeliveryKind.BASIC_ATTACK,
                    SkillTriggerDamageOriginKind.DIRECT
                )
            ),
            List.of(),
            List.of(new SkillTriggerAction(
                "reflect",
                "执行反伤",
                SkillTriggerActionType.EXECUTE_EFFECT,
                10,
                SkillTriggerTargetContext.EVENT_SOURCE,
                new SkillTriggerExecuteEffectActionDetail("reflect_damage"),
                List.of(),
                List.of()
            )),
            null,
            null
        );
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillTriggerRuleCreateRequest.class)))
            .thenReturn(response);

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "ruleKey":"on_damage_taken",
                      "name":"受到伤害",
                      "sortOrder":10,
                      "eventSource":{
                        "eventType":"DAMAGE_TAKEN",
                        "detail":{
                          "damageTypeKey":"physical",
                          "deliveryKind":"BASIC_ATTACK",
                          "originKind":"DIRECT"
                        }
                      },
                      "conditionGroups":[],
                      "actions":[{
                        "actionKey":"reflect",
                        "name":"执行反伤",
                        "actionType":"EXECUTE_EFFECT",
                        "sortOrder":10,
                        "targetContext":"EVENT_SOURCE",
                        "detail":{"effectKey":"reflect_damage"},
                        "runtimeInputBindings":[],
                        "resultModifiers":[]
                      }]
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.eventSource.eventType").value("DAMAGE_TAKEN"))
            .andExpect(jsonPath("$.eventSource.detail.damageTypeKey").value("physical"))
            .andExpect(jsonPath("$.eventSource.detail.deliveryKind").value("BASIC_ATTACK"))
            .andExpect(jsonPath("$.eventSource.detail.originKind").value("DIRECT"));

        ArgumentCaptor<SkillTriggerRuleCreateRequest> request = ArgumentCaptor.forClass(
            SkillTriggerRuleCreateRequest.class
        );
        verify(service).create(eq("lol"), eq("ezreal_q"), request.capture());
        SkillTriggerDamageEventDetail submitted = (SkillTriggerDamageEventDetail) request.getValue().eventSource().detail();
        assertEquals("physical", submitted.damageTypeKey());
        assertEquals(SkillTriggerDamageDeliveryKind.BASIC_ATTACK, submitted.deliveryKind());
        assertEquals(SkillTriggerDamageOriginKind.DIRECT, submitted.originKind());
    }

    @Test
    void hitLinkEventDetailDeserializesNullableSourceSkill() throws Exception {
        SkillTriggerRuleDetailResponse response = new SkillTriggerRuleDetailResponse(
            "on_hit_link",
            "命中联动",
            null,
            10,
            new SkillTriggerEventSource(
                SkillTriggerEventType.HIT_LINK_APPLIED,
                new SkillTriggerLinkEventDetail((String) null)
            ),
            List.of(),
            List.of(new SkillTriggerAction(
                "deal", "执行效果", SkillTriggerActionType.EXECUTE_EFFECT, 10,
                SkillTriggerTargetContext.CURRENT_TARGET,
                new SkillTriggerExecuteEffectActionDetail("burst"),
                List.of(),
                List.of()
            )),
            null,
            null
        );
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillTriggerRuleCreateRequest.class)))
            .thenReturn(response);

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "ruleKey":"on_hit_link",
                      "name":"命中联动",
                      "sortOrder":10,
                      "eventSource":{"eventType":"HIT_LINK_APPLIED","detail":{"sourceSkillKey":null}},
                      "conditionGroups":[],
                      "actions":[{
                        "actionKey":"deal","name":"执行效果","actionType":"EXECUTE_EFFECT","sortOrder":10,
                        "targetContext":"CURRENT_TARGET","detail":{"effectKey":"burst"},
                        "runtimeInputBindings":[],"resultModifiers":[]
                      }]
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.eventSource.eventType").value("HIT_LINK_APPLIED"));

        ArgumentCaptor<SkillTriggerRuleCreateRequest> request = ArgumentCaptor.forClass(
            SkillTriggerRuleCreateRequest.class
        );
        verify(service).create(eq("lol"), eq("ezreal_q"), request.capture());
        SkillTriggerLinkEventDetail submitted =
            (SkillTriggerLinkEventDetail) request.getValue().eventSource().detail();
        assertEquals(null, submitted.sourceSkillKey());
    }

    @Test
    void unknownOutputKindAndEventValueKeyReturnInvalidBody() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(priorResultJson("NOT_A_KIND")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(eventValueJson("NOT_A_VALUE")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));
        verify(service, never()).create(any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void newOutputKindAndEventValueKeyDeserialize() throws Exception {
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillTriggerRuleCreateRequest.class))).thenReturn(detail());
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(priorResultJson("RAW_DAMAGE")))
            .andExpect(status().isCreated());
        ArgumentCaptor<SkillTriggerRuleCreateRequest> prior = ArgumentCaptor.forClass(SkillTriggerRuleCreateRequest.class);
        verify(service).create(eq("lol"), eq("ezreal_q"), prior.capture());
        SkillTriggerPriorResultBindingDetail priorDetail = (SkillTriggerPriorResultBindingDetail)
            prior.getValue().actions().get(1).runtimeInputBindings().get(0).detail();
        assertEquals(SkillTriggerPriorResultOutputKind.RAW_DAMAGE, priorDetail.outputKind());
        assertEquals("deal_first", priorDetail.sourceActionKey());
        assertEquals("damage", priorDetail.sourceResultKey());

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(eventValueJson("SHIELD_ABSORBED")))
            .andExpect(status().isCreated());
        ArgumentCaptor<SkillTriggerRuleCreateRequest> event = ArgumentCaptor.forClass(SkillTriggerRuleCreateRequest.class);
        verify(service, org.mockito.Mockito.times(2)).create(eq("lol"), eq("ezreal_q"), event.capture());
        SkillTriggerEventValueBindingDetail eventDetail = (SkillTriggerEventValueBindingDetail)
            event.getValue().actions().get(0).runtimeInputBindings().get(0).detail();
        assertEquals(SkillTriggerEventValueKey.SHIELD_ABSORBED, eventDetail.eventValueKey());
    }

    private static String priorResultJson(String outputKind) {
        return """
            {
              "ruleKey":"prior_result",
              "name":"前序供值",
              "sortOrder":10,
              "eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},
              "conditionGroups":[],
              "actions":[
                {
                  "actionKey":"deal_first","name":"执行效果","actionType":"EXECUTE_EFFECT","sortOrder":10,
                  "targetContext":"CURRENT_TARGET","detail":{"effectKey":"burst"},
                  "runtimeInputBindings":[],"resultModifiers":[]
                },
                {
                  "actionKey":"follow","name":"后续","actionType":"EXECUTE_EFFECT","sortOrder":20,
                  "targetContext":"CURRENT_TARGET","detail":{"effectKey":"follow_up"},
                  "runtimeInputBindings":[{
                    "bindingKey":"from_first","parameterKey":"ratio","sourceType":"PRIOR_ACTION_RESULT",
                    "detail":{"sourceActionKey":"deal_first","sourceResultKey":"damage","outputKind":"%s"}
                  }],
                  "resultModifiers":[]
                }
              ]
            }
            """.formatted(outputKind);
    }

    private static String eventValueJson(String eventValueKey) {
        return """
            {
              "ruleKey":"on_damage_dealt",
              "name":"造成伤害",
              "sortOrder":10,
              "eventSource":{
                "eventType":"DAMAGE_DEALT",
                "detail":{"damageTypeKey":"physical","deliveryKind":"SKILL","originKind":"DIRECT"}
              },
              "conditionGroups":[],
              "actions":[{
                "actionKey":"deal","name":"执行效果","actionType":"EXECUTE_EFFECT","sortOrder":10,
                "targetContext":"CURRENT_TARGET","detail":{"effectKey":"burst"},
                "runtimeInputBindings":[{
                  "bindingKey":"from_event","parameterKey":"ratio","sourceType":"EVENT_VALUE",
                  "detail":{"eventValueKey":"%s"}
                }],
                "resultModifiers":[]
              }]
            }
            """.formatted(eventValueKey);
    }

    private static SkillTriggerRuleSummaryResponse summary() {
        return new SkillTriggerRuleSummaryResponse(
            "on_hit", "命中追加", null, SkillTriggerEventType.BASIC_ATTACK_HIT,
            0, 1, false, false, 10, TS
        );
    }

    private static SkillTriggerRuleDetailResponse detail() {
        return new SkillTriggerRuleDetailResponse(
            "on_hit",
            "命中追加",
            null,
            10,
            new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
            List.of(),
            List.of(new SkillTriggerAction(
                "deal", "执行效果", SkillTriggerActionType.EXECUTE_EFFECT, 10,
                SkillTriggerTargetContext.CURRENT_TARGET,
                new SkillTriggerExecuteEffectActionDetail("burst"),
                List.of(),
                List.of()
            )),
            null,
            null
        );
    }

    private static String createJson() {
        return """
            {
              "ruleKey":"on_hit",
              "name":"命中追加",
              "sortOrder":10,
              "eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},
              "conditionGroups":[],
              "actions":[{
                "actionKey":"deal","name":"执行效果","actionType":"EXECUTE_EFFECT","sortOrder":10,
                "targetContext":"CURRENT_TARGET","detail":{"effectKey":"burst"},
                "runtimeInputBindings":[],"resultModifiers":[]
              }]
            }
            """;
    }

    private static String updateJson() {
        return """
            {
              "name":"命中追加",
              "sortOrder":10,
              "eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},
              "conditionGroups":[],
              "actions":[{
                "actionKey":"deal","name":"执行效果","actionType":"EXECUTE_EFFECT","sortOrder":10,
                "targetContext":"CURRENT_TARGET","detail":{"effectKey":"burst"},
                "runtimeInputBindings":[],"resultModifiers":[]
              }]
            }
            """;
    }
}
