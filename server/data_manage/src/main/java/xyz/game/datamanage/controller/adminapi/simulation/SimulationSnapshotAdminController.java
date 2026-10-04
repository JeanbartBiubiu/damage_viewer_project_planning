package xyz.game.datamanage.controller.adminapi.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.service.simulation.SimulationSnapshotService;
import xyz.game.datamanage.service.simulation.SnapshotSelectionParser;

@RestController
@RequestMapping("/api/admin/games/{gameId}/simulation-snapshot")
public class SimulationSnapshotAdminController {
    private final SimulationSnapshotService service;

    public SimulationSnapshotAdminController(SimulationSnapshotService service) {
        this.service = service;
    }

    @PostMapping
    public SimulationSnapshotResponse get(@PathVariable String gameId,
                                          @RequestBody JsonNode body) {
        return service.get(gameId, SnapshotSelectionParser.parse(body));
    }
}
