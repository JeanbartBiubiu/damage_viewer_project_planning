package xyz.game.datamanage.controller.adminapi.skillinternalstate;

import static org.hamcrest.Matchers.hasItems;
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
import xyz.game.datamanage.mapper.skillinternalstate.SkillInternalStateMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCreateRequest;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetailResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateScope;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateSummaryResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateUpdateRequest;
import xyz.game.datamanage.service.skillinternalstate.SkillInternalStateService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillInternalStateAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillInternalStateAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skills/ezreal_q/internal-states";
    private static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-28T00:00:00Z");

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillInternalStateService service;
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
        when(service.list("lol", "ezreal_q")).thenReturn(List.of(summary()));
        when(service.get("lol", "ezreal_q", "mark_stacks")).thenReturn(detail());
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillInternalStateCreateRequest.class)))
            .thenReturn(detail());
        when(service.update(
            eq("lol"), eq("ezreal_q"), eq("mark_stacks"), any(SkillInternalStateUpdateRequest.class)
        )).thenReturn(detail());

        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].stateKey").value("mark_stacks"))
            .andExpect(jsonPath("$[0].stateType").value("COUNTER"))
            .andExpect(jsonPath("$[0].detail").doesNotExist());

        mockMvc.perform(get(BASE_PATH + "/mark_stacks"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.detail.initialValueFormulaKey").value("base_damage"));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(createJson()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.stateKey").value("mark_stacks"));

        mockMvc.perform(put(BASE_PATH + "/mark_stacks")
                .contentType(MediaType.APPLICATION_JSON)
                .content(updateJson()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stateKey").value("mark_stacks"));

        mockMvc.perform(delete(BASE_PATH + "/mark_stacks"))
            .andExpect(status().isNoContent())
            .andExpect(jsonPath("$").doesNotExist());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void illegalEnumAndImmutableKeyReturnInvalidBody() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "stateKey":"mark_stacks",
                      "name":"印记层数",
                      "stateType":"STACK",
                      "scope":"TARGET",
                      "sortOrder":0,
                      "detail":{"initialValueFormulaKey":"base_damage","maxValueFormulaKey":"max_stacks"}
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        mockMvc.perform(put(BASE_PATH + "/mark_stacks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "stateKey":"mark_stacks",
                      "name":"印记层数",
                      "stateType":"COUNTER",
                      "scope":"TARGET",
                      "sortOrder":0,
                      "detail":{"initialValueFormulaKey":"base_damage","maxValueFormulaKey":"max_stacks"}
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("stateKey"));

        verify(service, never()).create(any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void mutexDetailFieldsReturnInvalidBodyWithStableFieldPaths() throws Exception {
        GamesMapper gamesMapper = Mockito.mock(GamesMapper.class);
        SkillMapper skillMapper = Mockito.mock(SkillMapper.class);
        SkillInternalStateMapper stateMapper = Mockito.mock(SkillInternalStateMapper.class);
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        when(skillMapper.findByIdForUpdate("lol", "ezreal_q")).thenReturn(new SkillRow(
            "lol", "ezreal_q", "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS
        ));
        when(stateMapper.countByKey("lol", "ezreal_q", "mark_stacks")).thenReturn(0L);
        SkillInternalStateService realService =
            new SkillInternalStateService(gamesMapper, skillMapper, stateMapper);
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillInternalStateCreateRequest.class)))
            .thenAnswer(invocation -> realService.create(
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "stateKey":"mark_stacks",
                      "name":"印记层数",
                      "stateType":"COUNTER",
                      "scope":"TARGET",
                      "sortOrder":0,
                      "detail":{
                        "initialValueFormulaKey":"base_damage",
                        "maxValueFormulaKey":"max_stacks",
                        "initialEnabled":true
                      }
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"))
            .andExpect(jsonPath("$.error.details.fieldIssues[*].field", hasItems("detail.initialEnabled")))
            .andExpect(jsonPath("$..foreignFields").doesNotExist());

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void invalidInternalStateReferenceReturnsStableFieldPaths() throws Exception {
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillInternalStateCreateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_INTERNAL_STATE_REFERENCE",
                "内部状态引用不合法",
                Map.of(
                    "fieldIssues",
                    List.of(Map.of(
                        "field", "detail.initialValueFormulaKey",
                        "code", "UNKNOWN_FORMULA",
                        "message", "技能公式不存在或不属于当前技能"
                    ))
                )
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(createJson()))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_SKILL_INTERNAL_STATE_REFERENCE"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field")
                .value("detail.initialValueFormulaKey"));
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    private static String createJson() {
        return """
            {
              "stateKey":"mark_stacks",
              "name":"印记层数",
              "stateType":"COUNTER",
              "scope":"TARGET",
              "sortOrder":0,
              "detail":{"initialValueFormulaKey":"base_damage","maxValueFormulaKey":"max_stacks"}
            }
            """;
    }

    private static String updateJson() {
        return """
            {
              "name":"印记层数",
              "stateType":"COUNTER",
              "scope":"TARGET",
              "sortOrder":0,
              "detail":{"initialValueFormulaKey":"base_damage","maxValueFormulaKey":"max_stacks"}
            }
            """;
    }

    private static SkillInternalStateSummaryResponse summary() {
        return new SkillInternalStateSummaryResponse(
            "lol", "ezreal_q", "mark_stacks", "印记层数",
            SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET, null, 0, TS, TS
        );
    }

    private static SkillInternalStateDetailResponse detail() {
        return new SkillInternalStateDetailResponse(
            "lol", "ezreal_q", "mark_stacks", "印记层数",
            SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET, null, 0,
            new SkillInternalStateCounterDetail("base_damage", "max_stacks"),
            TS, TS
        );
    }
}
