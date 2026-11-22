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
import xyz.game.datamanage.support.account.*;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@org.springframework.context.annotation.Import(xyz.game.datamanage.support.auth.AccountControllerTestConfig.class)
class SimulationSnapshotAdminControllerTest {
    private static final String URL = "/api/admin/games/lol/simulation-snapshot";
    private static final Selection CHOICE = new Selection("hero_a", 1, "hero_b", 2,
        "shared_basic_attack", 1, List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    private final SimulationSnapshotService service = mock(SimulationSnapshotService.class);
    private final AccountSessions verifier = mock(AccountSessions.class);
    private ObjectMapper json;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        json = Jackson2ObjectMapperBuilder.json()
            .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
        mvc = MockMvcBuilders.standaloneSetup(new SimulationSnapshotAdminController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(json))
            .addFilters(new AdminAuthFilter(json, verifier, new AccountBrowser(new AccountProperties()),org.mockito.Mockito.mock(xyz.game.datamanage.support.maintenance.MaintenancePrincipals.class), org.mockito.Mockito.mock(xyz.game.datamanage.support.maintenance.DeploymentCredential.class))).build();
    }

    @Test
    void acceptsOnlyPostWithAllThirteenStructuredFields() throws Exception {
        when(service.get("lol", CHOICE)).thenReturn(snapshot(CHOICE));
        mvc.perform(request(body())).andExpect(status().isOk())
            .andExpect(jsonPath("$.selection.sourceLevel").value(1))
            .andExpect(jsonPath("$.selection.sourceBuildConfigurations").isEmpty())
            .andExpect(jsonPath("$.selection.targetBuildConfigurations").isEmpty())
            .andExpect(jsonPath("$.selection.sourceSkillSettings").isEmpty())
            .andExpect(jsonPath("$.selection.targetSkillSettings").isEmpty())
            .andExpect(jsonPath("$.selection.plannedSkills").isEmpty())
            .andExpect(jsonPath("$.executionSkillKeys").isArray())
            .andExpect(jsonPath("$.executionSkillKeys").isEmpty())
            .andExpect(jsonPath("$.snapshotDigest").value("scene-digest"))
            .andExpect(jsonPath("$.readAt").isString());
        verify(service).get("lol", CHOICE);
        mvc.perform(get(URL)).andExpect(status().isForbidden());
        verifyNoMoreInteractions(service);
    }

    @Test
    void anonymousReadIgnoresInvalidCookieAndNoCsrfIsRequired() throws Exception {
        mvc.perform(request(body()).cookie(new jakarta.servlet.http.Cookie("__Host-dv_session", "invalid")))
            .andExpect(status().isOk());
        verifyNoInteractions(verifier);
    }

    @ParameterizedTest
    @ValueSource(strings = {"sourceCharacterKey", "sourceLevel", "targetCharacterKey", "targetLevel",
        "sourceEquipmentKeys", "targetEquipmentKeys", "sourceBuildConfigurations", "targetBuildConfigurations",
        "sourceSkillSettings", "targetSkillSettings", "plannedSkills"})
    void everyFieldIsRequiredIncludingExplicitEmptyArrays(String field) throws Exception {
        ObjectNode request = body();
        request.remove(field);
        invalid(request, "selection." + field, "REQUIRED");
        request = body();
        request.putNull(field);
        invalid(request, "selection." + field, "REQUIRED");
        verifyNoInteractions(service);
    }

    @Test
    void basicAttackFieldsAreRequiredButCanOnlyBeNullAsAPair() throws Exception {
        for (String field : List.of("basicAttackSkillKey", "basicAttackLevel")) {
            ObjectNode missing = body();
            missing.remove(field);
            invalid(missing, "selection." + field, "REQUIRED");
            ObjectNode half = body();
            half.putNull(field);
            invalid(half, "selection." + field, "PAIR_REQUIRED");
        }
        ObjectNode request = body();
        request.putNull("basicAttackSkillKey");
        request.putNull("basicAttackLevel");
        Selection choice = SnapshotSelectionParser.parse(request);
        when(service.get("lol", choice)).thenReturn(snapshot(choice));
        mvc.perform(request(request)).andExpect(status().isOk())
            .andExpect(jsonPath("$.selection.basicAttackSkillKey").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.selection.basicAttackLevel").value(org.hamcrest.Matchers.nullValue()));
        verify(service).get("lol", choice);
    }

    @Test
    void plannedSkillsRequireStrictCompleteCharacterIdentitiesAndExplicitInitialPhase() throws Exception {
        ObjectNode request = body();
        request.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"INITIAL\"]")));
        Selection choice = SnapshotSelectionParser.parse(request);
        when(service.get("lol", choice)).thenReturn(snapshot(choice));
        mvc.perform(request(request)).andExpect(status().isOk())
            .andExpect(jsonPath("$.selection.plannedSkills[0].origin.characterKey").value("hero_a"))
            .andExpect(jsonPath("$.selection.plannedSkills[0].skillLevel").value(2))
            .andExpect(jsonPath("$.selection.plannedSkills[0].phaseKinds[0]").value("INITIAL"));
        verify(service).get("lol", choice);
        for (String field : List.of("origin", "skillKey", "skillLevel", "phaseKinds")) {
            ObjectNode missing = request.deepCopy();
            ((ObjectNode) missing.path("plannedSkills").get(0)).remove(field);
            invalid(missing, "selection.plannedSkills[0]." + field, "REQUIRED");
        }
        for (String phase : List.of("RECAST", "CHARGE_RELEASE", "CANCEL")) {
            ObjectNode unsupported = body();
            unsupported.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"" + phase + "\"]")));
            invalid(unsupported, "selection.plannedSkills[0].phaseKinds", "INITIAL_REQUIRED");
        }
        for (String phases : List.of("[\"INITIAL\",\"unknown\"]", "[\"INITIAL\",null]", "[\"INITIAL\",1]", "[\"INITIAL\",{}]")) {
            ObjectNode unsupported = body();
            unsupported.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, phases)));
            invalid(unsupported, "selection.plannedSkills[0].phaseKinds[1]", "ENUM_INVALID");
        }
        ObjectNode empty = body();
        empty.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[]")));
        invalid(empty, "selection.plannedSkills[0].phaseKinds", "REQUIRED");
        ObjectNode duplicatePhase = body();
        duplicatePhase.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"INITIAL\",\"INITIAL\"]")));
        invalid(duplicatePhase, "selection.plannedSkills[0].phaseKinds[1]", "DUPLICATE_KEY");
    }

    @Test
    void allDeclaredControlPhasesArePreservedAndRemainUnique() throws Exception {
        ObjectNode request = body();
        request.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"CANCEL\",\"RECAST\",\"INITIAL\",\"CHARGE_RELEASE\"]")));
        Selection choice = SnapshotSelectionParser.parse(request);
        when(service.get("lol", choice)).thenReturn(snapshot(choice));
        mvc.perform(request(request)).andExpect(status().isOk())
            .andExpect(jsonPath("$.selection.plannedSkills[0].phaseKinds[0]").value("CANCEL"))
            .andExpect(jsonPath("$.selection.plannedSkills[0].phaseKinds[3]").value("CHARGE_RELEASE"));
        for (String phase : List.of("RECAST", "CHARGE_RELEASE", "CANCEL")) {
            ObjectNode duplicate = body();
            duplicate.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"INITIAL\",\"" + phase + "\",\"" + phase + "\"]")));
            invalid(duplicate, "selection.plannedSkills[0].phaseKinds[2]", "DUPLICATE_KEY");
        }
    }

    @Test
    void plannedSkillsDoNotAcceptOtherOriginsTimingsHitPresetsOrCoercedLevels() throws Exception {
        for (String kind : List.of("EQUIPMENT", "BUILD_OPTION")) {
            ObjectNode request = body();
            request.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"INITIAL\"]")));
            ((ObjectNode) request.path("plannedSkills").get(0).path("origin")).put("kind", kind);
            invalid(request, "selection.plannedSkills[0].origin.kind", "ENUM_INVALID");
        }
        for (String field : List.of("atMs", "sortOrder", "hitPreset", "enabled", "skillActions")) {
            ObjectNode request = body();
            request.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"INITIAL\"]")));
            ((ObjectNode) request.path("plannedSkills").get(0)).put(field, "MISS");
            invalid(request, "selection.plannedSkills[0]." + field, "UNKNOWN_FIELD");
        }
        ObjectNode request = body();
        request.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"INITIAL\"]")));
        ((ObjectNode) request.path("plannedSkills").get(0).path("origin")).put("equipmentKey", "item");
        invalid(request, "selection.plannedSkills[0].origin.equipmentKey", "UNKNOWN_FIELD");
        request = body();
        request.set("plannedSkills", json.readTree(planned("hero_a", "spell", 2, "[\"INITIAL\"]")));
        ((ObjectNode) request.path("plannedSkills").get(0)).put("skillLevel", "2");
        invalid(request, "selection.plannedSkills[0].skillLevel", "INTEGER_REQUIRED");
        verifyNoInteractions(service);
    }

    @Test
    void plannedSkillLimitDuplicatesAndConflictingGradesAreRejectedAtOriginalIndices() throws Exception {
        ObjectNode request = body();
        for (int index = 0; index < 16; index++) {
            request.withArray("plannedSkills").add(json.readTree(planned("hero_a", "spell_" + index, 1, "[\"INITIAL\"]")).get(0));
        }
        Selection choice = SnapshotSelectionParser.parse(request);
        when(service.get("lol", choice)).thenReturn(snapshot(choice));
        mvc.perform(request(request)).andExpect(status().isOk());
        request.withArray("plannedSkills").add(json.readTree(planned("hero_a", "spell_16", 1, "[\"INITIAL\"]")).get(0));
        invalid(request, "selection.plannedSkills[16]", "SELECTION_LIMIT_EXCEEDED");
        ObjectNode duplicate = body();
        duplicate.set("plannedSkills", json.readTree(planned("hero_a", "spell", 1, "[\"INITIAL\"]")));
        duplicate.withArray("plannedSkills").add(duplicate.path("plannedSkills").get(0).deepCopy());
        invalid(duplicate, "selection.plannedSkills[1]", "DUPLICATE_KEY");
        ObjectNode conflicting = body();
        conflicting.set("plannedSkills", json.readTree(planned("hero_a", "spell", 1, "[\"INITIAL\"]")));
        conflicting.withArray("plannedSkills").add(json.readTree(planned("hero_b", "spell", 2, "[\"INITIAL\"]")).get(0));
        invalid(conflicting, "selection.plannedSkills[1].skillLevel", "LEVEL_CONFLICT");
        verify(service).get("lol", choice);
        verifyNoMoreInteractions(service);
    }

    private static String planned(String character, String skill, int level, String phases) {
        return """
            [{"origin":{"kind":"CHARACTER","characterKey":"%s"},"skillKey":"%s","skillLevel":%d,"phaseKinds":%s}]
            """.formatted(character, skill, level, phases);
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
        return new SimulationSnapshotResponse("lol", selection, null, null, List.of(), List.of(), null, List.of(),
            "scene-digest", OffsetDateTime.parse("2026-10-01T00:00:00Z"));
    }
}
