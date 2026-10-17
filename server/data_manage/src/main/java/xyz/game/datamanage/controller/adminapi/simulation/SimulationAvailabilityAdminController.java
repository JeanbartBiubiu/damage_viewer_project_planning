package xyz.game.datamanage.controller.adminapi.simulation;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse;
import xyz.game.datamanage.service.simulation.availability.SimulationAvailabilityService;

@RestController
@RequestMapping("/api/admin/games/{gameId}/simulation-availability")
public class SimulationAvailabilityAdminController {
    private final SimulationAvailabilityService service;

    public SimulationAvailabilityAdminController(SimulationAvailabilityService service) { this.service = service; }

    @GetMapping
    public SimulationAvailabilityResponse get(@PathVariable String gameId, @RequestParam String wasmSha256,
                                               @RequestParam String adapterVersion) {
        return service.get(gameId, wasmSha256, adapterVersion);
    }
}
