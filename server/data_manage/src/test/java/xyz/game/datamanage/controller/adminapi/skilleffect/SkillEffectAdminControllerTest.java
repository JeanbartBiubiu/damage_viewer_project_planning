package xyz.game.datamanage.controller.adminapi.skilleffect;

import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectAffectedSkillScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectSkillScopeMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleResponse;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.service.skilleffect.SkillEffectService;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillEffectAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillEffectAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skills/ezreal_q/effects";
    private static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-27T00:00:00Z");

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillEffectService service;
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
        SkillEffectSummaryResponse summary = summary();
        SkillEffectDetailResponse detail = detail();
        when(service.list("lol", "ezreal_q")).thenReturn(List.of(summary));
        when(service.get("lol", "ezreal_q", "on_hit_results")).thenReturn(detail);
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillEffectCreateRequest.class)))
            .thenReturn(detail);
        when(service.update(
            eq("lol"), eq("ezreal_q"), eq("on_hit_results"), any(SkillEffectUpdateRequest.class)
        )).thenReturn(detail);

        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].effectKey").value("on_hit_results"))
            .andExpect(jsonPath("$[0].resultCount").value(1))
            .andExpect(jsonPath("$[0].lifecycleEnabled").value(false))
            .andExpect(jsonPath("$[0].results").doesNotExist());

        mockMvc.perform(get(BASE_PATH + "/on_hit_results"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.skillKey").value("ezreal_q"))
            .andExpect(jsonPath("$.effectKey").value("on_hit_results"))
            .andExpect(jsonPath("$.results", hasSize(1)))
            .andExpect(jsonPath("$.results[0].resultType").value("DAMAGE"))
            .andExpect(jsonPath("$.results[0].detail.damageTypeKey").value("physical"))
            .andExpect(jsonPath("$.results[0].detail.deliveryKind").value("SKILL"))
            .andExpect(jsonPath("$.results[0].detail.originKind").value("DIRECT"))
            .andExpect(jsonPath("$.results[0].detail.critical.mode").value("DISALLOWED"))
            .andExpect(jsonPath("$.results[0].detail.vampRules", hasSize(0)))
            .andExpect(jsonPath("$.results[0].valueRule.value").value(org.hamcrest.Matchers.equalTo(Map.of("kind", "FORMULA", "formulaKey", "base_damage"))));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(createJson()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.effectKey").value("on_hit_results"))
            .andExpect(jsonPath("$.results[0].resultType").value("DAMAGE"));

        mockMvc.perform(put(BASE_PATH + "/on_hit_results")
                .contentType(MediaType.APPLICATION_JSON)
                .content(updateJson()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.effectKey").value("on_hit_results"));

        mockMvc.perform(delete(BASE_PATH + "/on_hit_results"))
            .andExpect(status().isNoContent())
            .andExpect(jsonPath("$").doesNotExist());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
        ArgumentCaptor<SkillEffectCreateRequest> createRequest = ArgumentCaptor.forClass(SkillEffectCreateRequest.class);
        verify(service).create(eq("lol"), eq("ezreal_q"), createRequest.capture());
        SkillEffectDamageDetail submitted = (SkillEffectDamageDetail) createRequest.getValue().results().get(0).detail();
        assertEquals("physical", submitted.damageTypeKey());
        assertEquals("SKILL", submitted.deliveryKind().name());
        assertEquals("DIRECT", submitted.originKind().name());
        assertEquals("DISALLOWED", submitted.critical().mode().name());
        assertEquals(0, submitted.vampRules().size());
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
    void putEffectKeyIsRejectedAsImmutable() throws Exception {
        mockMvc.perform(put(BASE_PATH + "/on_hit_results")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "effectKey":"on_hit_results",
                      "name":"命中结果",
                      "sortOrder":10,
                      "results":[
                        {
                          "resultKey":"physical_hit",
                          "name":"物理伤害",
                          "resultType":"DAMAGE",
                          "target":"TARGET",
                          "spellShieldBlockScope":null,
                          "sortOrder":0,
                          "valueRule":{"value":{"kind":"FORMULA","formulaKey":"base_damage"},"fixedMultiplier":1},
                          "detail":{"damageTypeKey":"physical"}
                        }
                      ]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("effectKey"));

        verify(service, never()).update(any(), any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void invalidResultTypeAndOperationReturnInvalidBodyBeforeService() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "effectKey":"on_hit_results",
                      "name":"命中结果",
                      "sortOrder":10,
                      "results":[
                        {
                          "resultKey":"physical_hit",
                          "name":"物理伤害",
                          "resultType":"UNKNOWN_RESULT",
                          "target":"TARGET",
                          "spellShieldBlockScope":null,
                          "sortOrder":0,
                          "detail":{"damageTypeKey":"physical"}
                        }
                      ]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "effectKey":"on_hit_results",
                      "name":"命中结果",
                      "sortOrder":10,
                      "results":[
                        {
                          "resultKey":"buff_ad",
                          "name":"增加攻击",
                          "resultType":"ATTRIBUTE_CHANGE",
                          "target":"SOURCE",
                          "spellShieldBlockScope":null,
                          "sortOrder":0,
                          "valueRule":{"value":{"kind":"FORMULA","formulaKey":"base_damage"},"fixedMultiplier":1},
                          "detail":{"attributeKey":"ad","operation":"ADD"}
                        }
                      ]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        verify(service, never()).create(any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void lifecycleOperationAndLifecycleObjectAreAcceptedByDeserializer() throws Exception {
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillEffectCreateRequest.class)))
            .thenReturn(detail());

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "effectKey":"refresh_mark",
                      "name":"刷新印记",
                      "sortOrder":20,
                      "lifecycle":{
                        "durationValue":{"kind":"FORMULA","formulaKey":"duration_f"},
                        "maxStacksValue":{"kind":"FORMULA","formulaKey":"max_stacks_f"},
                        "applicationStacksValue":{"kind":"FORMULA","formulaKey":"app_stacks_f"},
                        "instanceScope":"TARGET",
                        "reapplicationStackMode":"INCREASE",
                        "reapplicationDurationMode":"REFRESH_ALL",
                        "expiryMode":"ALL_AT_ONCE"
                      },
                      "results":[
                        {
                          "resultKey":"refresh_other",
                          "name":"刷新目标",
                          "resultType":"LIFECYCLE_OPERATION",
                          "target":"TARGET",
                          "spellShieldBlockScope":null,
                          "sortOrder":0,
                          "lifecycleBehavior":{"moment":"APPLICATION"},
                          "detail":{"targetEffectKey":"mark_effect","operation":"REFRESH"}
                        }
                      ]
                    }
                    """))
            .andExpect(status().isCreated());

        ArgumentCaptor<SkillEffectCreateRequest> captor =
            ArgumentCaptor.forClass(SkillEffectCreateRequest.class);
        verify(service).create(eq("lol"), eq("ezreal_q"), captor.capture());
        SkillEffectCreateRequest request = captor.getValue();
        assertNotNull(request.lifecycle());
        assertEquals(SkillEffectLifecycleInstanceScope.TARGET, request.lifecycle().instanceScope());
        assertEquals(SkillEffectResultType.LIFECYCLE_OPERATION, request.results().get(0).resultType());
        assertInstanceOf(SkillEffectLifecycleOperationDetail.class, request.results().get(0).detail());
        SkillEffectLifecycleOperationDetail detail =
            (SkillEffectLifecycleOperationDetail) request.results().get(0).detail();
        assertEquals("mark_effect", detail.targetEffectKey());
        assertEquals(SkillEffectLifecycleOperation.REFRESH, detail.operation());
        assertEquals(
            xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment.APPLICATION,
            request.results().get(0).lifecycleBehavior().moment()
        );
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
    }

    @Test
    void oldCooldownAffectedSkillKeysIsRejectedAsForeignField() throws Exception {
        GamesMapper gamesMapper = Mockito.mock(GamesMapper.class);
        SkillMapper skillMapper = Mockito.mock(SkillMapper.class);
        SkillEffectMapper effectMapper = Mockito.mock(SkillEffectMapper.class);
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        when(skillMapper.findByIdForUpdate("lol", "ezreal_q")).thenReturn(new SkillRow(
            "lol", "ezreal_q", "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS
        ));
        when(effectMapper.countByKey("lol", "ezreal_q", "reduce_cooldowns")).thenReturn(0L);
        SkillEffectService realService = new SkillEffectService(
            gamesMapper, skillMapper, effectMapper,
            Mockito.mock(SkillTriggerRuleService.class), Mockito.mock(ImageRelationMapper.class)
        , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillEffectCreateRequest.class)))
            .thenAnswer(invocation -> realService.create(
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "effectKey":"reduce_cooldowns",
                      "name":"减少技能冷却",
                      "sortOrder":20,
                      "results":[
                        {
                          "resultKey":"reduce_abilities",
                          "name":"减少技能冷却",
                          "resultType":"COOLDOWN_CHANGE",
                          "target":"SOURCE",
                          "spellShieldBlockScope":null,
                          "sortOrder":0,
                          "valueRule":{"value":{"kind":"FORMULA","formulaKey":"base_damage"},"fixedMultiplier":1},
                          "detail":{
                            "affectedSkillKeys":["ezreal_q","ezreal_w"],
                            "operation":"REDUCE"
                          }
                        }
                      ]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field")
                .value("results[0].detail.affectedSkillKeys"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("FIELD_MUTEX"));

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void publicSkillScopeIsAcceptedAndNormalizedByDeserializer() throws Exception {
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillEffectCreateRequest.class)))
            .thenReturn(detail());

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "effectKey":"reduce_cooldowns",
                      "name":"减少技能冷却",
                      "sortOrder":20,
                      "results":[
                        {
                          "resultKey":"reduce_abilities",
                          "name":"减少技能冷却",
                          "resultType":"COOLDOWN_CHANGE",
                          "target":"SOURCE",
                          "spellShieldBlockScope":null,
                          "sortOrder":0,
                          "valueRule":{"value":{"kind":"FORMULA","formulaKey":"base_damage"},"fixedMultiplier":1},
                          "detail":{
                            "affectedSkillScope":{
                              "mode":"SKILLS",
                              "skillKeys":["ezreal_q","ezreal_w","ezreal_e","ezreal_r"],
                              "skillCategoryKeys":[]
                            },
                            "operation":"REDUCE"
                          }
                        }
                      ]
                    }
                    """))
            .andExpect(status().isCreated());

        ArgumentCaptor<SkillEffectCreateRequest> captor =
            ArgumentCaptor.forClass(SkillEffectCreateRequest.class);
        verify(service).create(eq("lol"), eq("ezreal_q"), captor.capture());
        SkillEffectCooldownChangeDetail cooldown = assertInstanceOf(
            SkillEffectCooldownChangeDetail.class,
            captor.getValue().results().get(0).detail()
        );
        SkillEffectAffectedSkillScope scope = cooldown.affectedSkillScope();
        assertEquals(SkillEffectSkillScopeMode.SKILLS, scope.mode());
        assertEquals(List.of("ezreal_q", "ezreal_w", "ezreal_e", "ezreal_r"), scope.skillKeys());
        assertEquals(List.of(), scope.skillCategoryKeys());
        assertEquals(SkillEffectCooldownChangeOperation.REDUCE, cooldown.operation());
    }

    @Test
    void unknownLifecycleOperationReturnsInvalidBodyBeforeService() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "effectKey":"refresh_mark",
                      "name":"刷新印记",
                      "sortOrder":20,
                      "results":[
                        {
                          "resultKey":"refresh_other",
                          "name":"刷新目标",
                          "resultType":"LIFECYCLE_OPERATION",
                          "target":"TARGET",
                          "spellShieldBlockScope":null,
                          "sortOrder":0,
                          "detail":{"targetEffectKey":"mark_effect","operation":"RESET"}
                        }
                      ]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        verify(service, never()).create(any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void mutexDetailFieldsReturnInvalidBodyWithStableFieldPaths() throws Exception {
        GamesMapper gamesMapper = Mockito.mock(GamesMapper.class);
        SkillMapper skillMapper = Mockito.mock(SkillMapper.class);
        SkillEffectMapper effectMapper = Mockito.mock(SkillEffectMapper.class);
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        when(skillMapper.findByIdForUpdate("lol", "ezreal_q")).thenReturn(new SkillRow(
            "lol", "ezreal_q", "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS
        ));
        when(effectMapper.countByKey("lol", "ezreal_q", "on_hit_results")).thenReturn(0L);
        SkillEffectService realService = new SkillEffectService(
            gamesMapper, skillMapper, effectMapper,
            Mockito.mock(SkillTriggerRuleService.class), Mockito.mock(ImageRelationMapper.class)
        , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillEffectCreateRequest.class)))
            .thenAnswer(invocation -> realService.create(
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "effectKey":"on_hit_results",
                      "name":"命中结果",
                      "sortOrder":10,
                      "results":[
                        {
                          "resultKey":"physical_hit",
                          "name":"物理伤害",
                          "resultType":"DAMAGE",
                          "target":"TARGET",
                          "spellShieldBlockScope":null,
                          "sortOrder":0,
                          "valueRule":{"value":{"kind":"FORMULA","formulaKey":"base_damage"},"fixedMultiplier":1},
                          "detail":{"damageTypeKey":"physical","attributeKey":"ad","statusKey":"poison","targetEffectKey":"mark_effect"}
                        }
                      ]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"))
            .andExpect(jsonPath("$.error.details.fieldIssues[*].field", hasItems(
                "results[0].detail.attributeKey",
                "results[0].detail.statusKey",
                "results[0].detail.targetEffectKey"
            )))
            .andExpect(jsonPath("$.error.details.fieldIssues[*].code",
                org.hamcrest.Matchers.everyItem(org.hamcrest.Matchers.is("FIELD_MUTEX"))))
            .andExpect(jsonPath("$..foreignFields").doesNotExist());

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void invalidSkillEffectReferenceReturnsStableFieldPaths() throws Exception {
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillEffectCreateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_EFFECT_REFERENCE",
                "技能效果引用不合法",
                Map.of(
                    "fieldIssues",
                    List.of(
                        Map.of(
                            "field", "results[0].valueRule.value",
                            "code", "UNKNOWN_FORMULA",
                            "message", "技能公式不存在或不属于当前技能"
                        ),
                        Map.of(
                            "field", "results[0].detail.damageTypeKey",
                            "code", "UNKNOWN_DAMAGE_TYPE",
                            "message", "伤害类型不存在或不属于当前游戏"
                        )
                    )
                )
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(createJson()))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_SKILL_EFFECT_REFERENCE"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field")
                .value("results[0].valueRule.value"))
            .andExpect(jsonPath("$.error.details.fieldIssues[1].field")
                .value("results[0].detail.damageTypeKey"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("UNKNOWN_FORMULA"));

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void inboundEnrichedOutputConflictReturnsStable409Details() throws Exception {
        when(service.update(eq("lol"), eq("ezreal_q"), eq("on_hit_results"), any(SkillEffectUpdateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_EFFECT_IN_USE",
                "结果形状变化会使既有前序输出失效",
                Map.of("fieldIssues", List.of(Map.of(
                    "field", "results[0].detail.vampRules",
                    "code", "TRIGGER_RULE_SHAPE_IN_USE",
                    "ruleKey", "prior",
                    "actionKey", "follow",
                    "bindingKey", "from_first",
                    "outputKind", "ACTUAL_HEALING"
                )))
            ));
        mockMvc.perform(put(BASE_PATH + "/on_hit_results")
                .contentType(MediaType.APPLICATION_JSON)
                .content(updateJson()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.SKILL_EFFECT_IN_USE"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("TRIGGER_RULE_SHAPE_IN_USE"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("results[0].detail.vampRules"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].ruleKey").value("prior"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].actionKey").value("follow"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].bindingKey").value("from_first"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].outputKind").value("ACTUAL_HEALING"));
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    private static String createJson() {
        return """
            {
              "effectKey":"on_hit_results",
              "name":"命中结果",
              "description":null,
              "sortOrder":10,
              "results":[
                {
                  "resultKey":"physical_hit",
                  "name":"物理伤害",
                  "resultType":"DAMAGE",
                  "target":"TARGET",
                  "spellShieldBlockScope":null,
                  "sortOrder":0,
                  "valueRule":{"value":{"kind":"FORMULA","formulaKey":"base_damage"},"fixedMultiplier":1},
                  "detail":{
                    "damageTypeKey":"physical",
                    "deliveryKind":"SKILL",
                    "originKind":"DIRECT",
                    "critical":{"mode":"DISALLOWED","multiplierValue":null},
                    "vampRules":[]
                  }
                }
              ]
            }
            """;
    }

    private static String updateJson() {
        return """
            {
              "name":"命中结果",
              "description":null,
              "sortOrder":10,
              "results":[
                {
                  "resultKey":"physical_hit",
                  "name":"物理伤害",
                  "resultType":"DAMAGE",
                  "target":"TARGET",
                  "spellShieldBlockScope":null,
                  "sortOrder":0,
                  "valueRule":{"value":{"kind":"FORMULA","formulaKey":"base_damage"},"fixedMultiplier":1},
                  "detail":{
                    "damageTypeKey":"physical",
                    "deliveryKind":"SKILL",
                    "originKind":"DIRECT",
                    "critical":{"mode":"DISALLOWED","multiplierValue":null},
                    "vampRules":[]
                  }
                }
              ]
            }
            """;
    }

    private static SkillEffectSummaryResponse summary() {
        return new SkillEffectSummaryResponse(
            "lol", "ezreal_q", "on_hit_results", "命中结果", null, 10, 1, TS, TS
        );
    }

    private static SkillEffectDetailResponse detail() {
        return new SkillEffectDetailResponse(
            "lol",
            "ezreal_q",
            "on_hit_results",
            "命中结果",
            null,
            10,
            List.of(new SkillEffectResultResponse(
                "physical_hit",
                "物理伤害",
                SkillEffectResultType.DAMAGE,
                SkillEffectTarget.TARGET,
                null,
                0,
                new SkillEffectValueRuleResponse(SkillNumericValue.formula("base_damage"), BigDecimal.ONE, null, null),
                new SkillEffectDamageDetail("physical")
            )),
            TS,
            TS
        );
    }
}
