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
import xyz.game.datamanage.model.skillformula.SkillFormulaCreateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaSummaryResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaUpdateRequest;
import xyz.game.datamanage.service.skillformula.SkillFormulaService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = SkillFormulaAdminController.class)
@Import({xyz.game.datamanage.support.auth.AccountControllerTestConfig.class, AdminAuthFilter.class, GlobalExceptionHandler.class})
class SkillFormulaAdminControllerTest {

    private static final String BASE_PATH = "/api/admin/games/lol/skills/varus_w/formulas";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private SkillFormulaService service;
    @MockitoBean private AdminEditLogHelper logHelper;

    @Test void completeCommonDefinitionTravelsThroughCrudAndEditLogs() throws Exception {
        var detail=detail();
        when(service.list("lol","varus_w")).thenReturn(List.of(new SkillFormulaSummaryResponse("lol","varus_w","damage","伤害",null,1,null,null)));
        when(service.get("lol","varus_w","damage")).thenReturn(detail);
        when(service.create(eq("lol"),eq("varus_w"),any())).thenReturn(detail);
        when(service.update(eq("lol"),eq("varus_w"),eq("damage"),any())).thenReturn(detail);
        mockMvc.perform(get(BASE_PATH)).andExpect(status().isOk()).andExpect(jsonPath("$[0].expression").doesNotExist());
        mockMvc.perform(get(BASE_PATH+"/damage")).andExpect(status().isOk()).andExpect(jsonPath("$.expression.outputStageKey").value("output"))
            .andExpect(jsonPath("$.expression.stages[0].expression.value").value("1.00000000000000001"));
        String definition=detail.expression().toString();
        mockMvc.perform(post(BASE_PATH).contentType(MediaType.APPLICATION_JSON).content("{\"formulaKey\":\"damage\",\"name\":\"伤害\",\"sortOrder\":1,\"expression\":"+definition+"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.expression.stages[0].expression.value").value("1.00000000000000001"));
        mockMvc.perform(put(BASE_PATH+"/damage").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"伤害\",\"sortOrder\":1,\"expression\":"+definition+"}"))
            .andExpect(status().isOk());
        mockMvc.perform(delete(BASE_PATH+"/damage")).andExpect(status().isNoContent());
        verify(logHelper).log(any(),any(),any(JsonNode.class),eq(201));verify(logHelper).log(any(),any(),any(JsonNode.class),eq(200));verify(logHelper).log(any(),any(),any(JsonNode.class),eq(204));
    }
    @Test void missingParentRetainsNotFound() throws Exception {
        when(service.list("lol","varus_w")).thenThrow(new ApiException(HttpStatus.NOT_FOUND,"404.SKILL_NOT_FOUND","技能不存在",Map.of()));
        mockMvc.perform(get(BASE_PATH)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("404.SKILL_NOT_FOUND"));
    }
    @Test void invalidCommonStructureAndForeignParameterReturnDefinitionPointer() throws Exception {
        when(service.create(eq("lol"),eq("varus_w"),any())).thenAnswer(call->{SkillFormulaCreateRequest request=call.getArgument(2);
            xyz.game.datamanage.service.skillformula.SkillFormulaParser.validateBeforeCatalog("varus_w",request.expression());return detail();});
        mockMvc.perform(post(BASE_PATH).contentType(MediaType.APPLICATION_JSON).content("{\"formulaKey\":\"damage\",\"name\":\"伤害\",\"sortOrder\":1,\"expression\":{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"p\"}}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));
        var foreign=xyz.game.datamanage.support.formula.SkillFormulaFixtures.parameter("foreign","same");
        mockMvc.perform(post(BASE_PATH).contentType(MediaType.APPLICATION_JSON).content("{\"formulaKey\":\"damage\",\"name\":\"伤害\",\"sortOrder\":1,\"expression\":"+foreign+"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("FORMULA_UNKNOWN_BINDING"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("/expression/inputs/0/binding"));
        verify(logHelper,never()).log(any(),any(),any(),anyInt());
    }
    @Test void invalidRequestMetadataIsRejectedBeforeService() throws Exception {
        mockMvc.perform(post(BASE_PATH).contentType(MediaType.APPLICATION_JSON).content("{\"formulaKey\":\"Invalid Key\",\"name\":\"伤害\",\"sortOrder\":1,\"expression\":"+detail().expression()+"}"))
            .andExpect(status().isBadRequest());verify(service,never()).create(any(),any(),any());
    }
    private static SkillFormulaDetailResponse detail(){return new SkillFormulaDetailResponse("lol","varus_w","damage","伤害",null,1,
        xyz.game.datamanage.support.formula.SkillFormulaFixtures.constant("1.00000000000000001"),null,null);}
}