package xyz.game.datamanage.controller.adminapi.simulation;

import java.util.List;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.service.simulation.SimulationSnapshotService;

@RestController
@RequestMapping("/api/admin/games/{gameId}/simulation-snapshot")
public class SimulationSnapshotAdminController {
    private final SimulationSnapshotService service;

    public SimulationSnapshotAdminController(SimulationSnapshotService service) {
        this.service = service;
    }

    @GetMapping
    public SimulationSnapshotResponse get(@PathVariable String gameId,
                                          @RequestParam String sourceCharacterKey,
                                          @RequestParam int sourceLevel,
                                          @RequestParam String targetCharacterKey,
                                          @RequestParam int targetLevel,
                                          @RequestParam String basicAttackSkillKey,
                                          @RequestParam int basicAttackLevel,
                                          @RequestParam MultiValueMap<String, String> queryParameters) {
        return service.get(gameId, new SimulationSnapshotResponse.Selection(sourceCharacterKey, sourceLevel,
            targetCharacterKey, targetLevel, basicAttackSkillKey, basicAttackLevel,
            queryParameters.getOrDefault("sourceEquipmentKeys", List.of()),
            queryParameters.getOrDefault("targetEquipmentKeys", List.of())));
    }
}
