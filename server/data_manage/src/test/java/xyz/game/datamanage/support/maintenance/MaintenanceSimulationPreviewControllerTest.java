package xyz.game.datamanage.support.maintenance;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.service.simulation.SimulationSnapshotService;
import xyz.game.datamanage.support.error.ApiException;

class MaintenanceSimulationPreviewControllerTest {
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final MaintenanceSessions sessions = mock(MaintenanceSessions.class);
    private final SimulationSnapshotService snapshots = mock(SimulationSnapshotService.class);
    private final MaintenanceSimulationPreviewController controller = new MaintenanceSimulationPreviewController(sessions, snapshots, json);
    private final MockHttpServletRequest request = new MockHttpServletRequest();

    @Test void missingMaintenanceProofStopsBeforeCandidateRead() throws Exception {
        doThrow(MaintenanceJson.denied()).when(sessions).require(request, true);
        assertThrows(ApiException.class, () -> controller.preview("lol", body(), request));
        verifyNoInteractions(snapshots);
    }

    @Test void strictBodyAndTypedChangesRefuseUnknownFieldsBeforeAssembly() throws Exception {
        var extraRoot = body(); extraRoot.put("write", true);
        assertThrows(ApiException.class, () -> controller.preview("lol", extraRoot, request));
        var extraUpdate = body(); ((ObjectNode) extraUpdate.path("updates").get(0)).put("expected", true);
        assertThrows(ApiException.class, () -> controller.preview("lol", extraUpdate, request));
        var extraRequest = body(); ((ObjectNode) extraRequest.path("updates").get(0).path("request")).put("gameId", "other");
        assertThrows(ApiException.class, () -> controller.preview("lol", extraRequest, request));
        verifyNoInteractions(snapshots);
    }

    @Test void verifiedPrivateReadForwardsSelectionAndOriginalPatchRequest() throws Exception {
        SimulationSnapshotResponse result = mock(SimulationSnapshotResponse.class);
        when(snapshots.preview(eq("lol"), any(), any())).thenReturn(result);
        assertSame(result, controller.preview("lol", body(), request));
        verify(sessions).require(request, true);
        verify(snapshots).preview(eq("lol"), argThat(selection -> selection.sourceCharacterKey().equals("hero_a")),
            argThat(updates -> updates.size() == 1 && updates.getFirst().skillKey().equals("skill_q")
                && updates.getFirst().request().baseDigest().equals("baseline") && updates.getFirst().request().changes().isEmpty()));
    }

    private ObjectNode body() throws Exception {
        return (ObjectNode) json.readTree("""
            {"selection":{"sourceCharacterKey":"hero_a","sourceLevel":1,"targetCharacterKey":"hero_b","targetLevel":1,
             "basicAttackSkillKey":null,"basicAttackLevel":null,"sourceEquipmentKeys":[],"targetEquipmentKeys":[],
             "sourceBuildConfigurations":[],"targetBuildConfigurations":[],"sourceSkillSettings":[],"targetSkillSettings":[],"plannedSkills":[]},
             "updates":[{"skillKey":"skill_q","request":{"baseDigest":"baseline","skill":null,"changes":[]}}]}
            """);
    }
}
