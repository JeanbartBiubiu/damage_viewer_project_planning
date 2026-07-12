package xyz.game.datamanage.controller.publicapi.combatdata;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.combatdata.provider.ProviderCombatDataService;

@RestController
@RequestMapping("/api/games/{gameId}/combat-data")
public class CombatDataProviderPublicController {

    private final ProviderCombatDataService service;

    public CombatDataProviderPublicController(ProviderCombatDataService service) {
        this.service = service;
    }

    @GetMapping("/providers")
    public ObjectNode listProviders(@PathVariable("gameId") String gameId) {
        return service.listProviders(gameId);
    }

    @GetMapping("/provider-lifecycles")
    public ObjectNode listLifecycles(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "providerId", required = false) String providerId
    ) {
        return service.listLifecycles(gameId, providerId);
    }

    @GetMapping("/provider-state-fields")
    public ObjectNode listStateFields(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "providerId", required = false) String providerId
    ) {
        return service.listStateFields(gameId, providerId);
    }

    @GetMapping("/provider-formulas")
    public ObjectNode listFormulas(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "providerId", required = false) String providerId
    ) {
        return service.listFormulas(gameId, providerId);
    }

    @GetMapping("/provider-modifiers")
    public ObjectNode listModifiers(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "providerId", required = false) String providerId
    ) {
        return service.listModifiers(gameId, providerId);
    }

    @GetMapping("/provider-listeners")
    public ObjectNode listListeners(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "providerId", required = false) String providerId,
        @RequestParam(name = "abilityId", required = false) String abilityId
    ) {
        return service.listListeners(gameId, providerId, abilityId);
    }

    @GetMapping("/listener-match-types")
    public ObjectNode listMatchTypes(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "listenerId", required = false) String listenerId
    ) {
        return service.listMatchTypes(gameId, listenerId);
    }

    @GetMapping("/provider-tick-sequences")
    public ObjectNode listTickSequences(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "providerId", required = false) String providerId,
        @RequestParam(name = "sequenceId", required = false) String sequenceId
    ) {
        return service.listTickSequences(gameId, providerId, sequenceId);
    }
}
