package xyz.game.datamanage.controller.adminapi.simulation;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.service.simulation.SimulationSnapshotService;
import xyz.game.datamanage.service.simulation.SnapshotSelectionParser;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

class SimulationSnapshotAdminControllerTest {
    private static final String URL = "/api/admin/games/lol/simulation-snapshot";
    private static final Selection CHOICE = new Selection("hero_a", 1, "hero_b", 2,
        "shared_basic_attack", 1, List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    private final SimulationSnapshotService service = mock(SimulationSnapshotService.class);
    private final JwtVerifier verifier = mock(JwtVerifier.class);
    private ObjectMapper json;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        json = Jackson2ObjectMapperBuilder.json()
            .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
        mvc = MockMvcBuilders.standaloneSetup(new SimulationSnapshotAdminController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(json))
            .addFilters(new AdminAuthFilter(json, verifier)).build();
        when(verifier.isDisabled()).thenReturn(true);
        when(verifier.developmentAuthContext()).thenReturn(new AuthContext("test@example.invalid", true, true));
    }

    @Test
    void acceptsOnlyPostWithAllTwelveStructuredFields() throws Exception {
        when(service.get("lol", CHOICE)).thenReturn(snapshot(CHOICE));
        mvc.perform(request(body())).andExpect(status().isOk())
            .andExpect(jsonPath("$.selection.sourceLevel").value(1))
            .andExpect(jsonPath("$.selection.sourceBuildConfigurations").isEmpty())
            .andExpect(jsonPath("$.selection.targetBuildConfigurations").isEmpty())
            .andExpect(jsonPath("$.selection.sourceSkillSettings").isEmpty())
            .andExpect(jsonPath("$.selection.targetSkillSettings").isEmpty())
            .andExpect(jsonPath("$.snapshotDigest").value("scene-digest"))
            .andExpect(jsonPath("$.readAt").isString());
        verify(service).get("lol", CHOICE);
        mvc.perform(get(URL)).andExpect(status().isMethodNotAllowed());
        verifyNoMoreInteractions(service);
    }

    @Test
    void authenticationAndEditPermissionStillApply() throws Exception {
        when(verifier.isDisabled()).thenReturn(false);
        mvc.perform(request(body())).andExpect(status().isUnauthorized());
        when(verifier.verify("fixture")).thenReturn(new AuthContext("test@example.invalid", false, false));
        mvc.perform(request(body()).header("Authorization", "Bearer fixture")).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @ParameterizedTest
    @ValueSource(strings = {"sourceCharacterKey", "sourceLevel", "targetCharacterKey", "targetLevel",
        "basicAttackSkillKey", "basicAttackLevel", "sourceEquipmentKeys", "targetEquipmentKeys",
        "sourceBuildConfigurations", "targetBuildConfigurations", "sourceSkillSettings", "targetSkillSettings"})
    void everyFieldIsRequiredIncludingExplicitEmptyArrays(String field) throws Exception {
        ObjectNode request = body();
        request.remove(field);
        invalid(request, "selection." + field, "REQUIRED");
        request = body();
        request.putNull(field);
        invalid(request, "selection." + field, "REQUIRED");
        verifyNoInteractions(service);
    }

    @ParameterizedTest
    @ValueSource(strings = {"sourceSkillSelections", "targetSkillSelections", "extraSkills", "enabledRuleKeys"})
    void legacyAndExtraFieldsAreRejected(String field) throws Exception {
        ObjectNode request = body();
        request.putArray(field);
        invalid(request, "selection." + field, "UNKNOWN_FIELD");
        verifyNoInteractions(service);
    }

    @Test
    void integersAndSwitchesNeverUseJacksonCoercion() throws Exception {
        ObjectNode request = body();
        request.put("sourceLevel", "1");
        invalid(request, "selection.sourceLevel", "INTEGER_REQUIRED");
        request = body();
        request.put("basicAttackLevel", 1.5);
        invalid(request, "selection.basicAttackLevel", "INTEGER_REQUIRED");
        request = body();
        request.put("targetLevel", 2147483648L);
        invalid(request, "selection.targetLevel", "INTEGER_REQUIRED");
        request = body();
        request.put("sourceLevel", -1);
        invalid(request, "selection.sourceLevel", "RANGE_INVALID");
        request = body();
        request.set("sourceSkillSettings", json.readTree("""
            [{"origin":{"kind":"CHARACTER","characterKey":"hero_a"},"skillKey":"shared_basic_attack","enabled":"false"}]
            """));
        invalid(request, "selection.sourceSkillSettings[0].enabled", "BOOLEAN_REQUIRED");
        verifyNoInteractions(service);
    }

    @Test
    void forwardsBuildInstancesAndAllThreeOriginShapesWithoutGrantingAnything() throws Exception {
        ObjectNode request = body();
        request.set("sourceBuildConfigurations", json.readTree("""
            [{"systemKey":"runes","groupAssignments":[{"roleKey":"main","groupKey":"tree"}],
              "selections":[{"roleKey":"main","groupKey":"tree","slotKey":"one","optionKey":"power","rank":1}],"budgets":{}}]
            """));
        request.set("sourceSkillSettings", json.readTree("""
            [{"origin":{"kind":"CHARACTER","characterKey":"hero_a"},"skillKey":"shared_basic_attack","enabled":false,"skillLevel":0},
             {"origin":{"kind":"EQUIPMENT","equipmentKey":"item_a"},"skillKey":"passive","enabled":false},
             {"origin":{"kind":"BUILD_OPTION","systemKey":"runes","roleKey":"main","groupKey":"tree","slotKey":"one","optionKey":"power"},
              "skillKey":"passive","enabled":false}]
            """));
        Selection choice = SnapshotSelectionParser.parse(request);
        when(service.get("lol", choice)).thenReturn(snapshot(choice));
        mvc.perform(request(request)).andExpect(status().isOk())
            .andExpect(jsonPath("$.selection.sourceSkillSettings[2].origin.kind").value("BUILD_OPTION"));
        verify(service).get("lol", choice);
    }

    @Test
    void originFieldsAreStrictByKindAndDuplicateIdentityIsRejected() throws Exception {
        ObjectNode request = body();
        request.set("sourceSkillSettings", json.readTree("""
            [{"origin":{"kind":"CHARACTER","characterKey":"hero_a","equipmentKey":"item_a"},"skillKey":"skill","enabled":true}]
            """));
        invalid(request, "selection.sourceSkillSettings[0].origin.equipmentKey", "UNKNOWN_FIELD");
        request = body();
        request.set("targetSkillSettings", json.readTree("""
            [{"origin":{"kind":"BUILD_OPTION","systemKey":"runes","roleKey":"main","groupKey":"tree","optionKey":"power"},
              "skillKey":"skill","enabled":true}]
            """));
        invalid(request, "selection.targetSkillSettings[0].origin.slotKey", "REQUIRED");
        request = body();
        request.set("sourceSkillSettings", json.readTree("""
            [{"origin":{"kind":"EQUIPMENT","equipmentKey":"item_a"},"skillKey":"skill","enabled":true},
             {"origin":{"kind":"EQUIPMENT","equipmentKey":"item_a"},"skillKey":"skill","enabled":false}]
            """));
        invalid(request, "selection.sourceSkillSettings[1]", "DUPLICATE_KEY");
        verifyNoInteractions(service);
    }

    @Test
    void equipmentDuplicatesCountsAndCommaStringsAreRejectedBeforeService() throws Exception {
        ObjectNode request = body();
        request.putArray("sourceEquipmentKeys").add("item_a").add("item_a");
        invalid(request, "selection.sourceEquipmentKeys[1]", "DUPLICATE_KEY");
        request = body();
        for (int index = 0; index < 7; index++) request.withArray("targetEquipmentKeys").add("item_" + index);
        invalid(request, "selection.targetEquipmentKeys[6]", "SELECTION_LIMIT_EXCEEDED");
        request = body();
        request.putArray("sourceEquipmentKeys").add("item_a,item_b");
        invalid(request, "selection.sourceEquipmentKeys[0]", "KEY_INVALID");
        verifyNoInteractions(service);
    }

    @Test
    void buildBodiesAndDuplicateSystemSelectionsAreStrict() throws Exception {
        ObjectNode request = body();
        request.set("sourceBuildConfigurations", json.readTree("""
            [{"systemKey":"runes","groupAssignments":[],"selections":[],"budgets":{},"skills":[]}]
            """));
        invalid(request, "selection.sourceBuildConfigurations[0].skills", "UNKNOWN_FIELD");
        request = body();
        request.set("sourceBuildConfigurations", json.readTree("""
            [{"systemKey":"runes","groupAssignments":[],"selections":[],"budgets":{}},
             {"systemKey":"runes","groupAssignments":[],"selections":[],"budgets":{}}]
            """));
        invalid(request, "selection.sourceBuildConfigurations[1].systemKey", "DUPLICATE_KEY");
        request = body();
        request.set("targetBuildConfigurations", json.readTree("""
            [{"systemKey":"tree","groupAssignments":[],"selections":[],"budgets":{"points":1.5}}]
            """));
        invalid(request, "selection.targetBuildConfigurations[0].budgets.points", "INTEGER_REQUIRED");
        verifyNoInteractions(service);
    }

    @Test
    void dependencyFailureReturnsExistingConflictShapeWithoutPartialSnapshot() throws Exception {
        when(service.get("lol", CHOICE)).thenThrow(new ApiException(HttpStatus.CONFLICT,
            "409.SIMULATION_SNAPSHOT_INVALID", "依赖缺失", Map.of("fieldIssues", List.of(
                Map.of("field", "source.skillSources[0]", "code", "REFERENCE_MISSING")))));
        mvc.perform(request(body())).andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.SIMULATION_SNAPSHOT_INVALID"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value("REFERENCE_MISSING"))
            .andExpect(jsonPath("$.source").doesNotExist()).andExpect(jsonPath("$.snapshotDigest").doesNotExist());
    }

    private ObjectNode body() {
        return json.valueToTree(CHOICE);
    }

    private MockHttpServletRequestBuilder request(ObjectNode body) {
        return post(URL).contentType(MediaType.APPLICATION_JSON).content(body.toString());
    }

    private void invalid(ObjectNode body, String field, String code) throws Exception {
        mvc.perform(request(body)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value(field))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].code").value(code));
    }

    private static SimulationSnapshotResponse snapshot(Selection selection) {
        return new SimulationSnapshotResponse("lol", selection, null, null, List.of(), null, List.of(),
            "scene-digest", OffsetDateTime.parse("2026-10-01T00:00:00Z"));
    }
}
