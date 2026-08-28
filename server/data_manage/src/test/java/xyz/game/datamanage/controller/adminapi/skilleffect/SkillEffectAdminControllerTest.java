package xyz.game.datamanage.controller.adminapi.skilleffect;

import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.hasSize;
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
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleResponse;
import xyz.game.datamanage.service.skilleffect.SkillEffectService;
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
            .andExpect(jsonPath("$[0].results").doesNotExist());

        mockMvc.perform(get(BASE_PATH + "/on_hit_results"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.skillKey").value("ezreal_q"))
            .andExpect(jsonPath("$.effectKey").value("on_hit_results"))
            .andExpect(jsonPath("$.results", hasSize(1)))
            .andExpect(jsonPath("$.results[0].resultType").value("DAMAGE"))
            .andExpect(jsonPath("$.results[0].detail.damageTypeKey").value("physical"))
            .andExpect(jsonPath("$.results[0].valueRule.formulaKey").value("base_damage"));

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
                          "sortOrder":0,
                          "valueRule":{"formulaKey":"base_damage","fixedMultiplier":1},
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
                          "resultType":"EXECUTE",
                          "target":"TARGET",
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
                          "sortOrder":0,
                          "valueRule":{"formulaKey":"base_damage","fixedMultiplier":1},
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
    void mutexDetailFieldsReturnInvalidBodyWithStableFieldPaths() throws Exception {
        GamesMapper gamesMapper = Mockito.mock(GamesMapper.class);
        SkillMapper skillMapper = Mockito.mock(SkillMapper.class);
        SkillEffectMapper effectMapper = Mockito.mock(SkillEffectMapper.class);
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        when(skillMapper.findByIdForUpdate("lol", "ezreal_q")).thenReturn(new SkillRow(
            "lol", "ezreal_q", "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS
        ));
        when(effectMapper.countByKey("lol", "ezreal_q", "on_hit_results")).thenReturn(0L);
        SkillEffectService realService = new SkillEffectService(gamesMapper, skillMapper, effectMapper);
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
                          "sortOrder":0,
                          "valueRule":{"formulaKey":"base_damage","fixedMultiplier":1},
                          "detail":{"damageTypeKey":"physical","attributeKey":"ad","statusKey":"poison"}
                        }
                      ]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"))
            .andExpect(jsonPath("$.error.details.fieldIssues[*].field", hasItems(
                "results[0].detail.attributeKey",
                "results[0].detail.statusKey"
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
                            "field", "results[0].valueRule.formulaKey",
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
                .value("results[0].valueRule.formulaKey"))
            .andExpect(jsonPath("$.error.details.fieldIssues[1].field")
                .value("results[0].detail.damageTypeKey"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("UNKNOWN_FORMULA"));

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
                  "sortOrder":0,
                  "valueRule":{"formulaKey":"base_damage","fixedMultiplier":1},
                  "detail":{"damageTypeKey":"physical"}
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
                  "sortOrder":0,
                  "valueRule":{"formulaKey":"base_damage","fixedMultiplier":1},
                  "detail":{"damageTypeKey":"physical"}
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
                new SkillEffectValueRuleResponse("base_damage", BigDecimal.ONE, null, null),
                new SkillEffectDamageDetail("physical")
            )),
            TS,
            TS
        );
    }
}
