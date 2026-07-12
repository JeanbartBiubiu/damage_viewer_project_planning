package xyz.game.datamanage.controller.publicapi.combatdata;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.combatdata.effect.EffectCombatDataService;

@RestController
@RequestMapping("/api/games/{gameId}/combat-data")
public class CombatDataEffectPublicController {

    private final EffectCombatDataService service;

    public CombatDataEffectPublicController(EffectCombatDataService service) {
        this.service = service;
    }

    @GetMapping("/effect-sequences")
    public ObjectNode listSequences(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "providerId", required = false) String providerId
    ) {
        return service.listSequences(gameId, providerId);
    }

    @GetMapping("/effect-steps")
    public ObjectNode listSteps(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "sequenceId", required = false) String sequenceId
    ) {
        return service.listSteps(gameId, sequenceId);
    }

    @GetMapping("/ability-phase-effect-sequences")
    public ObjectNode listPhaseEffectSequences(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "phaseId", required = false) String phaseId,
        @RequestParam(name = "sequenceId", required = false) String sequenceId
    ) {
        return service.listPhaseEffectSequences(gameId, phaseId, sequenceId);
    }

    @GetMapping("/listener-effect-sequences")
    public ObjectNode listListenerEffectSequences(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "listenerId", required = false) String listenerId,
        @RequestParam(name = "sequenceId", required = false) String sequenceId
    ) {
        return service.listListenerEffectSequences(gameId, listenerId, sequenceId);
    }
}
