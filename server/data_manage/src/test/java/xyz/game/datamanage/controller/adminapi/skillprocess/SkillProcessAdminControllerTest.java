package xyz.game.datamanage.controller.adminapi.skillprocess;

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
import xyz.game.datamanage.mapper.skillprocess.SkillProcessMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessCreateRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessDetailResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessEffectBindingResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessImmediateStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skillprocess.SkillProcessSummaryResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessUpdateRequest;
import xyz.game.datamanage.service.skillprocess.SkillProcessService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillProcessAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillProcessAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skills/ezreal_q/processes";
    private static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-28T00:00:00Z");

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillProcessService service;
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
        when(service.get("lol", "ezreal_q", "cast")).thenReturn(detail());
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillProcessCreateRequest.class)))
            .thenReturn(detail());
        when(service.update(eq("lol"), eq("ezreal_q"), eq("cast"), any(SkillProcessUpdateRequest.class)))
            .thenReturn(detail());

        mockMvc.perform(get(BASE_PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].processKey").value("cast"))
            .andExpect(jsonPath("$[0].stepCount").value(1))
            .andExpect(jsonPath("$[0].steps").doesNotExist());

        mockMvc.perform(get(BASE_PATH + "/cast"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.steps[0].stepType").value("IMMEDIATE"))
            .andExpect(jsonPath("$.effectBindings[0].effectKey").value("on_hit_results"));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content(createJson()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.processKey").value("cast"));

        mockMvc.perform(put(BASE_PATH + "/cast")
                .contentType(MediaType.APPLICATION_JSON)
                .content(updateJson()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.processKey").value("cast"));

        mockMvc.perform(delete(BASE_PATH + "/cast"))
            .andExpect(status().isNoContent())
            .andExpect(jsonPath("$").doesNotExist());

        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
        verify(logHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(204));
    }

    @Test
    void illegalEnumAndImmutableProcessKeyReturnInvalidBody() throws Exception {
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "processKey":"cast",
                      "name":"施放",
                      "activationType":"TOGGLE",
                      "sortOrder":0,
                      "steps":[{"stepKey":"cast","name":"立即","stepType":"IMMEDIATE","sortOrder":0,"detail":{}}],
                      "effectBindings":[{"bindingKey":"hit","effectKey":"on_hit_results","moment":{"momentType":"PROCESS_START"},"sortOrder":0}],
                      "stateOperations":[]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "processKey":"cast",
                      "name":"施放",
                      "activationType":"ACTIVE",
                      "sortOrder":0,
                      "steps":[{"stepKey":"cast","name":"立即","stepType":"SCRIPT","sortOrder":0,"detail":{}}],
                      "effectBindings":[{"bindingKey":"hit","effectKey":"on_hit_results","moment":{"momentType":"PROCESS_START"},"sortOrder":0}],
                      "stateOperations":[]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"));

        mockMvc.perform(put(BASE_PATH + "/cast")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "processKey":"cast",
                      "name":"施放",
                      "activationType":"ACTIVE",
                      "sortOrder":0,
                      "steps":[{"stepKey":"cast","name":"立即","stepType":"IMMEDIATE","sortOrder":0,"detail":{}}],
                      "effectBindings":[{"bindingKey":"hit","effectKey":"on_hit_results","moment":{"momentType":"PROCESS_START"},"sortOrder":0}],
                      "stateOperations":[]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("processKey"));

        verify(service, never()).create(any(), any(), any());
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void mutexDetailFieldsReturnInvalidBodyWithStableFieldPaths() throws Exception {
        GamesMapper gamesMapper = Mockito.mock(GamesMapper.class);
        SkillMapper skillMapper = Mockito.mock(SkillMapper.class);
        SkillProcessMapper processMapper = Mockito.mock(SkillProcessMapper.class);
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        when(skillMapper.findByIdForUpdate("lol", "ezreal_q")).thenReturn(new SkillRow(
            "lol", "ezreal_q", "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS
        ));
        when(processMapper.countByKey("lol", "ezreal_q", "cast")).thenReturn(0L);
        SkillProcessService realService = new SkillProcessService(gamesMapper, skillMapper, processMapper);
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillProcessCreateRequest.class)))
            .thenAnswer(invocation -> realService.create(
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            ));

        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "processKey":"cast",
                      "name":"施放",
                      "activationType":"ACTIVE",
                      "sortOrder":0,
                      "steps":[{
                        "stepKey":"cast",
                        "name":"立即",
                        "stepType":"IMMEDIATE",
                        "sortOrder":0,
                        "detail":{"delayFormulaKey":"base_damage"}
                      }],
                      "effectBindings":[{
                        "bindingKey":"hit",
                        "effectKey":"on_hit_results",
                        "moment":{"momentType":"PROCESS_START"},
                        "sortOrder":0
                      }],
                      "stateOperations":[]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_BODY"))
            .andExpect(jsonPath("$.error.details.fieldIssues[*].field", hasItems(
                "steps[0].detail.delayFormulaKey"
            )))
            .andExpect(jsonPath("$..foreignFields").doesNotExist());

        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    @Test
    void emptyBehaviorAndUnknownStepReturnStableFieldPaths() throws Exception {
        when(service.create(eq("lol"), eq("ezreal_q"), any(SkillProcessCreateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能过程不合法",
                Map.of(
                    "fieldIssues",
                    List.of(
                        Map.of("field", "effectBindings", "code", "PROCESS_BEHAVIOR_REQUIRED", "message", "过程至少需要一个效果挂接或内部状态操作"),
                        Map.of("field", "stateOperations", "code", "PROCESS_BEHAVIOR_REQUIRED", "message", "过程至少需要一个效果挂接或内部状态操作")
                    )
                )
            ));
        mockMvc.perform(post(BASE_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "processKey":"cast",
                      "name":"施放",
                      "activationType":"ACTIVE",
                      "sortOrder":0,
                      "steps":[{"stepKey":"cast","name":"立即","stepType":"IMMEDIATE","sortOrder":0,"detail":{}}],
                      "effectBindings":[],
                      "stateOperations":[]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[*].field", hasItems(
                "effectBindings", "stateOperations"
            )));

        when(service.update(eq("lol"), eq("ezreal_q"), eq("cast"), any(SkillProcessUpdateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_PROCESS_REFERENCE",
                "技能过程引用不合法",
                Map.of(
                    "fieldIssues",
                    List.of(Map.of(
                        "field", "effectBindings[0].moment.stepKey",
                        "code", "UNKNOWN_STEP",
                        "message", "步骤不存在或不属于当前过程"
                    ))
                )
            ));
        mockMvc.perform(put(BASE_PATH + "/cast")
                .contentType(MediaType.APPLICATION_JSON)
                .content(updateJson()))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.INVALID_SKILL_PROCESS_REFERENCE"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field")
                .value("effectBindings[0].moment.stepKey"));
        verify(logHelper, never()).log(any(), any(), any(), anyInt());
    }

    private static String createJson() {
        return """
            {
              "processKey":"cast",
              "name":"施放",
              "activationType":"ACTIVE",
              "sortOrder":0,
              "steps":[{"stepKey":"cast","name":"立即","stepType":"IMMEDIATE","sortOrder":0,"detail":{}}],
              "effectBindings":[{"bindingKey":"hit","effectKey":"on_hit_results","moment":{"momentType":"PROCESS_START"},"sortOrder":0}],
              "stateOperations":[]
            }
            """;
    }

    private static String updateJson() {
        return """
            {
              "name":"施放",
              "activationType":"ACTIVE",
              "sortOrder":0,
              "steps":[{"stepKey":"cast","name":"立即","stepType":"IMMEDIATE","sortOrder":0,"detail":{}}],
              "effectBindings":[{"bindingKey":"hit","effectKey":"on_hit_results","moment":{"momentType":"PROCESS_START"},"sortOrder":0}],
              "stateOperations":[]
            }
            """;
    }

    private static SkillProcessSummaryResponse summary() {
        return new SkillProcessSummaryResponse(
            "lol", "ezreal_q", "cast", "施放", SkillProcessActivationType.ACTIVE, null, 0, 1, 1, 0, TS, TS
        );
    }

    private static SkillProcessDetailResponse detail() {
        return new SkillProcessDetailResponse(
            "lol",
            "ezreal_q",
            "cast",
            "施放",
            SkillProcessActivationType.ACTIVE,
            null,
            0,
            null,
            List.of(new SkillProcessStepResponse(
                "cast", "立即", SkillProcessStepType.IMMEDIATE, null, 0, new SkillProcessImmediateStepDetail()
            )),
            List.of(new SkillProcessEffectBindingResponse(
                "hit",
                "on_hit_results",
                new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null),
                0
            )),
            List.of(),
            TS,
            TS
        );
    }
}
