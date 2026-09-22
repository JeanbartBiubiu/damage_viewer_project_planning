package xyz.game.datamanage.controller.adminapi.character;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckResponse;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckResponse.*;
import xyz.game.datamanage.service.character.CharacterAuthoringCheckService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

class CharacterAuthoringCheckAdminControllerTest {
    private static final String URL = "/api/admin/games/lol/characters/hero/authoring-check";
    private final CharacterAuthoringCheckService service = mock(CharacterAuthoringCheckService.class);
    private final JwtVerifier verifier = mock(JwtVerifier.class);
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        ObjectMapper objectMapper = Jackson2ObjectMapperBuilder.json().featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
        mvc = MockMvcBuilders.standaloneSetup(new CharacterAuthoringCheckAdminController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(objectMapper))
            .addFilters(new AdminAuthFilter(objectMapper, verifier)).build();
        when(verifier.isDisabled()).thenReturn(true);
        when(verifier.developmentAuthContext()).thenReturn(new AuthContext("test@example.invalid", true, true));
    }

    @Test
    void findingsReturn200WithSeparateConclusionsAndCompleteReferenceLocation() throws Exception {
        when(service.check("lol", "hero")).thenReturn(new CharacterAuthoringCheckResponse("lol", "hero", "测试角色",
            OffsetDateTime.parse("2026-09-06T00:00:00Z"), new Conclusions("HAS_ERRORS", "NOT_CHECKED", "NOT_RUN"),
            new Summary(1, 0, 1, 0), List.of(new Skill("missing", null, null, null, 0, 0, 0, 0)),
            List.of(new Reference("skill", "TRIGGER", "hit", "actions[0]", "RESULT", "skill", "effect", "damage",
                xyz.game.datamanage.service.character.AuthoringCheckLocationResolver.resolve("skill", "TRIGGER", "hit", "actions[0]",
                    new ObjectMapper().readTree("{\"actions\":[{\"actionKey\":\"deal\"}]}")))),
            List.of(new Issue("ATTACHED_SKILL_MISSING", "ERROR", "关联技能不存在", "missing", "SKILL", "missing", "skillKey",
                xyz.game.datamanage.service.character.AuthoringCheckLocationResolver.missingSkill("missing", "missing", "skillKey")))));
        mvc.perform(get(URL)).andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol")).andExpect(jsonPath("$.characterKey").value("hero"))
            .andExpect(jsonPath("$.checkedAt").isString()).andExpect(jsonPath("$.conclusions.structure").value("HAS_ERRORS"))
            .andExpect(jsonPath("$.conclusions.mechanics").value("NOT_CHECKED")).andExpect(jsonPath("$.conclusions.runtime").value("NOT_RUN"))
            .andExpect(jsonPath("$.summary.attachedSkillCount").value(1)).andExpect(jsonPath("$.summary.configuredAttributeCount").value(0))
            .andExpect(jsonPath("$.summary.errorCount").value(1)).andExpect(jsonPath("$.summary.reviewCount").value(0))
            .andExpect(jsonPath("$.skills[0].skillKey").value("missing")).andExpect(jsonPath("$.skills[0].name").isEmpty())
            .andExpect(jsonPath("$.skills[0].status").isEmpty()).andExpect(jsonPath("$.skills[0].maxLevel").isEmpty())
            .andExpect(jsonPath("$.references[0].sourceSkillKey").value("skill")).andExpect(jsonPath("$.references[0].targetSubKey").value("damage"))
            .andExpect(jsonPath("$.references[0].location.editor").value("TRIGGER_RULE"))
            .andExpect(jsonPath("$.references[0].location.segments[0].kind").value("KEYED_CHILD"))
            .andExpect(jsonPath("$.references[0].location.segments[0].key").value("deal"))
            .andExpect(jsonPath("$.issues[0].location.editor").value("CHARACTER_RELATIONS"))
            .andExpect(jsonPath("$.issues[0].location.degradeReason").value("OBJECT_MISSING"))
            .andExpect(jsonPath("$.issues[0].code").value("ATTACHED_SKILL_MISSING"))
            .andExpect(jsonPath("$.issues[0].fieldPath").value("skillKey")).andExpect(jsonPath("$.issues[0].target").doesNotExist());
        verify(service).check("lol", "hero");
        verifyNoMoreInteractions(service);
    }

    @Test
    void authenticationAndEditPermissionRemainRequired() throws Exception {
        when(verifier.isDisabled()).thenReturn(false);
        mvc.perform(get(URL)).andExpect(status().isUnauthorized());
        when(verifier.verify("fixture")).thenReturn(new AuthContext("test@example.invalid", false, false));
        mvc.perform(get(URL).header("Authorization", "Bearer fixture")).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void missingResourceKeepsExisting404AndReadFailureDoesNotLookLikeAReport() throws Exception {
        when(service.check("lol", "hero")).thenThrow(new ApiException(HttpStatus.NOT_FOUND, "404.CHARACTER_NOT_FOUND", "角色不存在"));
        mvc.perform(get(URL)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("404.CHARACTER_NOT_FOUND"));
        doThrow(new IllegalStateException("authoring-check test read failure")).when(service).check("lol", "hero");
        mvc.perform(get(URL)).andExpect(status().isInternalServerError()).andExpect(jsonPath("$.conclusions").doesNotExist());
    }
}
