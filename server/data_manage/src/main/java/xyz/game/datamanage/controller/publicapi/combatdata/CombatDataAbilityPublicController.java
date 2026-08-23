package xyz.game.datamanage.controller.publicapi.combatdata;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.combatdata.ability.AbilityCombatDataService;

@RestController
@RequestMapping("/api/games/{gameId}/combat-data")
public class CombatDataAbilityPublicController {

    private final AbilityCombatDataService service;

    public CombatDataAbilityPublicController(AbilityCombatDataService service) {
        this.service = service;
    }

    @GetMapping("/abilities")
    public ObjectNode listAbilities(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "providerId", required = false) String providerId
    ) {
        return service.listAbilities(gameId, providerId);
    }

    @GetMapping("/ability-parameters")
    public ObjectNode listParameters(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "abilityId", required = false) String abilityId
    ) {
        return service.listParameters(gameId, abilityId);
    }

    @GetMapping("/ability-state-fields")
    public ObjectNode listStateFields(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "abilityId", required = false) String abilityId
    ) {
        return service.listStateFields(gameId, abilityId);
    }

    @GetMapping("/ability-phases")
    public ObjectNode listPhases(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "abilityId", required = false) String abilityId
    ) {
        return service.listPhases(gameId, abilityId);
    }

    @GetMapping("/ability-cooldowns")
    public ObjectNode listCooldowns(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "abilityId", required = false) String abilityId
    ) {
        return service.listCooldowns(gameId, abilityId);
    }
}
