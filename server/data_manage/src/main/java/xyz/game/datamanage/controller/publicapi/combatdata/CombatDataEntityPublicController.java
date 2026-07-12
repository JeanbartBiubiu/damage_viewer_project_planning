package xyz.game.datamanage.controller.publicapi.combatdata;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.combatdata.entity.EntityCombatDataService;

@RestController
@RequestMapping("/api/games/{gameId}/combat-data")
public class CombatDataEntityPublicController {

    private final EntityCombatDataService service;

    public CombatDataEntityPublicController(EntityCombatDataService service) {
        this.service = service;
    }

    @GetMapping("/entities")
    public ObjectNode listEntities(@PathVariable("gameId") String gameId) {
        return service.listEntities(gameId);
    }

    @GetMapping("/entities/{entityId}")
    public ObjectNode getEntity(
        @PathVariable("gameId") String gameId,
        @PathVariable("entityId") String entityId
    ) {
        return service.getEntity(gameId, entityId);
    }

    @GetMapping("/entity-attributes")
    public ObjectNode listEntityAttributes(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "entityId", required = false) String entityId
    ) {
        return service.listEntityAttributes(gameId, entityId);
    }

    @GetMapping("/entity-attribute-stages")
    public ObjectNode listEntityAttributeStages(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "entityId", required = false) String entityId,
        @RequestParam(name = "attrKey", required = false) String attrKey
    ) {
        return service.listEntityAttributeStages(gameId, entityId, attrKey);
    }

    @GetMapping("/entity-resources")
    public ObjectNode listEntityResources(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "entityId", required = false) String entityId
    ) {
        return service.listEntityResources(gameId, entityId);
    }

    @GetMapping("/entity-resource-stages")
    public ObjectNode listEntityResourceStages(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "entityId", required = false) String entityId,
        @RequestParam(name = "resourceKey", required = false) String resourceKey
    ) {
        return service.listEntityResourceStages(gameId, entityId, resourceKey);
    }

    @GetMapping("/entity-provider-mounts")
    public ObjectNode listEntityProviderMounts(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "entityId", required = false) String entityId,
        @RequestParam(name = "providerId", required = false) String providerId
    ) {
        return service.listEntityProviderMounts(gameId, entityId, providerId);
    }
}
