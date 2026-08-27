package xyz.game.datamanage.controller.adminapi.skillformula;

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
import xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper;
import xyz.game.datamanage.model.skillformula.AttributeOwner;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaCreateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperation;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperationNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaParameterNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaSummaryResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaUpdateRequest;
import xyz.game.datamanage.service.skillformula.SkillFormulaService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillFormulaAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillFormulaAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skills/varus_w/formulas";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillFormulaService service;
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
        SkillFormulaSummaryResponse summary = summary();
        SkillFormulaDetailResponse detail = detail();
        when(service.list("lol", "varus_w")).thenReturn(List.of(summary));
        when(service.get("lol", "varus_w", "missing_health_damage")).thenReturn(detail);
        when(service.create(eq("lol"), eq("varus_w"), any(SkillFormulaCreateRequest.class)))
            .thenReturn(detail);
        when(service.update(
            eq("lol"), eq("varus_w"), eq("missing_health_damage"), any(SkillFormulaUpdateRequest.class)
        )).thenReturn(detail);

        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].formulaKey").value("missing_health_damage"))
            .andExpect(jsonPath("$[0].expression").doesNotExist());

        mockMvc.perform(get(BASE_PATH + "/missing_health_damage"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.skillKey").value("varus_w"))
            .andExpect(jsonPath("$.expression.nodeType").value("OPERATION"))
            .andExpect(jsonPath("$.expression.operation").value("MULTIPLY"))
            .andExpect(jsonPath("$.expression.operands", hasSize(2)))
            .andExpect(jsonPath("$.expression.operands[0].nodeType").value("ATTRIBUTE"))
            .andExpect(jsonPath("$.expression.operands[0].attributeOwner").value("TARGET"))
            .andExpect(jsonPath("$.expression.operands[0].attributeKey").value("hp"))
            .andExpect(jsonPath("$.expression.operands[0].attributeValueKind").value("MISSING"))
            .andExpect(jsonPath("$.expression.operands[1].nodeType").value("PARAMETER"))
            .andExpect(jsonPath("$.expression.operands[1].parameterKey").value("missing_health_ratio"))
            .andExpect(jsonPath("$.expression.nodeId").doesNotExist())
            .andExpect(jsonPath("$.expression.operands[0].nodeId").doesNotExist());

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "formulaKey":"missing_health_damage",
                      "name":"已损失生命值伤害",
                      "description":null,
                      "sortOrder":10,
                      "expression":{
                        "nodeType":"OPERATION",
                        "operation":"MULTIPLY",
                        "operands":[
                          {
                            "nodeType":"ATTRIBUTE",
                            "attributeOwner":"TARGET",
                            "attributeKey":"hp",
                            "attributeValueKind":"MISSING"
                          },
                          {
                            "nodeType":"PARAMETER",
                            "parameterKey":"missing_health_ratio"
                          }
                        ]
                      }
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.formulaKey").value("missing_health_damage"))
            .andExpect(jsonPath("$.expression.operands[0].attributeValueKind").value("MISSING"));

        mockMvc.perform(put(BASE_PATH + "/missing_health_damage")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name":"已损失生命值伤害",
                      "description":null,
                      "sortOrder":10,
                      "expression":{
                        "nodeType":"OPERATION",
                        "operation":"MULTIPLY",
                        "operands":[
                          {
                            "nodeType":"ATTRIBUTE",
                            "attributeOwner":"TARGET",
                            "attributeKey":"hp",
                            "attributeValueKind":"MISSING"
                          },
                          {
                            "nodeType":"PARAMETER",
                            "parameterKey":"missing_health_ratio"
                          }
                        ]
                      }
                    }
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sortOrder").value(10));

        mockMvc.perform(delete(BASE_PATH + "/missing_health_damage"))
            .andExpect(status().isNoContent())
            .andExpect(jsonPath("$").doesNotExist());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void missingParentReturns404ForListInsteadOfEmptyArray() throws Exception {
        when(service.list("lol", "varus_w")).thenThrow(new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_NOT_FOUND",
            "技能不存在",
            Map.of("skillKey", "varus_w")
        ));

        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("404.SKILL_NOT_FOUND"));
    }

    @Test
    void putFormulaKeyIsRejectedAsImmutable() throws Exception {
        when(service.update(
            eq("lol"), eq("varus_w"), eq("missing_health_damage"), any(SkillFormulaUpdateRequest.class)
        )).thenThrow(new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.VALIDATION_FAILED",
            "技能公式不合法",
            Map.of(
                "fieldIssues",
                List.of(Map.of(
                    "field", "formulaKey",
                    "code", "IMMUTABLE",
                    "message", "公式标识不能修改"
                ))
            )
        ));

        mockMvc.perform(put(BASE_PATH + "/missing_health_damage")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "formulaKey":"missing_health_damage",
                      "name":"已损失生命值伤害",
                      "sortOrder":10,
                      "expression":{"nodeType":"PARAMETER","parameterKey":"ratio"}
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("formulaKey"));

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void invalidFormulaReferenceReturnsStableFieldPaths() throws Exception {
        when(service.create(eq("lol"), eq("varus_w"), any(SkillFormulaCreateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_FORMULA_REFERENCE",
                "公式引用不合法",
                Map.of(
                    "fieldIssues",
                    List.of(
                        Map.of(
                            "field", "expression.operands[0].parameterKey",
                            "code", "UNKNOWN_SKILL_PARAMETER",
                            "message", "技能参数不存在或不属于当前技能"
                        ),
                        Map.of(
                            "field", "expression.operands[1].attributeKey",
                            "code", "UNKNOWN_ATTRIBUTE",
                            "message", "属性不存在或不属于当前游戏"
                        )
                    )
                )
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "formulaKey":"bad_refs",
                      "name":"引用错误",
                      "sortOrder":1,
                      "expression":{
                        "nodeType":"OPERATION",
                        "operation":"ADD",
                        "operands":[
                          {"nodeType":"PARAMETER","parameterKey":"missing_param"},
                          {
                            "nodeType":"ATTRIBUTE",
                            "attributeOwner":"SOURCE",
                            "attributeKey":"missing_attr",
                            "attributeValueKind":"TOTAL"
                          }
                        ]
                      }
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_FORMULA_REFERENCE"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field")
                .value("expression.operands[0].parameterKey"))
            .andExpect(jsonPath("$.error.details.fieldIssues[1].field")
                .value("expression.operands[1].attributeKey"))
            .andExpect(jsonPath("$.error.details.fieldIssues[1].code").value("UNKNOWN_ATTRIBUTE"));

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void unknownNodeTypeReturnsInvalidBody() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "formulaKey":"literal",
                      "name":"字面量",
                      "sortOrder":1,
                      "expression":{"nodeType":"LITERAL","value":1}
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        verify(service, never()).create(any(), any(), any());
    }

    @Test
    void rejectsParameterCarryingOperationFieldsViaHttp() throws Exception {
        GamesMapper gamesMapper = Mockito.mock(GamesMapper.class);
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        SkillFormulaService realService = new SkillFormulaService(
            gamesMapper,
            Mockito.mock(SkillMapper.class),
            Mockito.mock(SkillFormulaMapper.class)
        );
        when(service.create(eq("lol"), eq("varus_w"), any(SkillFormulaCreateRequest.class)))
            .thenAnswer(invocation -> realService.create(
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "formulaKey":"mutex_parameter",
                      "name":"参数互斥",
                      "sortOrder":1,
                      "expression":{
                        "nodeType":"PARAMETER",
                        "parameterKey":"ratio",
                        "operation":"ADD",
                        "operands":[
                          {"nodeType":"PARAMETER","parameterKey":"left"},
                          {"nodeType":"PARAMETER","parameterKey":"right"}
                        ]
                      }
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[*].field",
                org.hamcrest.Matchers.hasItems("expression.operation", "expression.operands")))
            .andExpect(jsonPath("$.error.details.fieldIssues[*].code",
                org.hamcrest.Matchers.everyItem(org.hamcrest.Matchers.is("FIELD_MUTEX"))))
            .andExpect(jsonPath("$.expression").doesNotExist())
            .andExpect(jsonPath("$.error.details.fieldIssues[0].value").doesNotExist())
            .andExpect(jsonPath("$..nodeId").doesNotExist())
            .andExpect(jsonPath("$..foreignFields").doesNotExist());

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void rejectsOperationCarryingParameterKeyViaHttp() throws Exception {
        GamesMapper gamesMapper = Mockito.mock(GamesMapper.class);
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        SkillFormulaService realService = new SkillFormulaService(
            gamesMapper,
            Mockito.mock(SkillMapper.class),
            Mockito.mock(SkillFormulaMapper.class)
        );
        when(service.create(eq("lol"), eq("varus_w"), any(SkillFormulaCreateRequest.class)))
            .thenAnswer(invocation -> realService.create(
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "formulaKey":"mutex_operation",
                      "name":"运算互斥",
                      "sortOrder":1,
                      "expression":{
                        "nodeType":"OPERATION",
                        "operation":"ADD",
                        "parameterKey":"ratio",
                        "operands":[
                          {"nodeType":"PARAMETER","parameterKey":"left"},
                          {"nodeType":"PARAMETER","parameterKey":"right"}
                        ]
                      }
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("expression.parameterKey"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("FIELD_MUTEX"))
            .andExpect(jsonPath("$..foreignFields").doesNotExist())
            .andExpect(jsonPath("$..nodeId").doesNotExist());

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    private static SkillFormulaSummaryResponse summary() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillFormulaSummaryResponse(
            "lol",
            "varus_w",
            "missing_health_damage",
            "已损失生命值伤害",
            null,
            10,
            timestamp,
            timestamp
        );
    }

    private static SkillFormulaDetailResponse detail() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillFormulaDetailResponse(
            "lol",
            "varus_w",
            "missing_health_damage",
            "已损失生命值伤害",
            null,
            10,
            new SkillFormulaOperationNode(
                SkillFormulaOperation.MULTIPLY,
                List.of(
                    new SkillFormulaAttributeNode(
                        AttributeOwner.TARGET,
                        "hp",
                        AttributeValueKind.MISSING
                    ),
                    new SkillFormulaParameterNode("missing_health_ratio")
                )
            ),
            timestamp,
            timestamp
        );
    }
}
