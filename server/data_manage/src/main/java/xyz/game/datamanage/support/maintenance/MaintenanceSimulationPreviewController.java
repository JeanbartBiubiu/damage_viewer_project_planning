package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.simulation.SimulationPreviewUpdate;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.service.simulation.SimulationSnapshotService;
import xyz.game.datamanage.service.simulation.SnapshotSelectionParser;

/** 私有只读预检，不属于配置保存控制器，也不会打开维护窗口。 */
@RestController
@RequestMapping("/internal/maintenance/games/{gameId}/simulation-preview")
public class MaintenanceSimulationPreviewController {
    private final SimulationSnapshotService snapshots;
    private final ObjectMapper json;

    public MaintenanceSimulationPreviewController(SimulationSnapshotService snapshots, ObjectMapper json) {
        this.snapshots = snapshots;
        this.json = json;
    }

    @PostMapping
    public SimulationSnapshotResponse preview(@PathVariable String gameId, @RequestBody JsonNode body,
        @RequestAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) MaintenancePrincipal principal) {
        MaintenanceJson.fields(body, "selection", "updates");
        if (!body.path("updates").isArray() || body.path("updates").isEmpty() || body.path("updates").size() > 32) {
            throw MaintenanceJson.invalid();
        }
        var updates = new ArrayList<SimulationPreviewUpdate>();
        try {
            for (JsonNode update : body.path("updates")) {
                MaintenanceJson.fields(update, "skillKey", "request");
                updates.add(json.treeToValue(update, SimulationPreviewUpdate.class));
            }
        } catch (JsonProcessingException ex) {
            throw MaintenanceJson.invalid();
        }
        return snapshots.preview(gameId, SnapshotSelectionParser.parse(body.path("selection")), updates);
    }
}
