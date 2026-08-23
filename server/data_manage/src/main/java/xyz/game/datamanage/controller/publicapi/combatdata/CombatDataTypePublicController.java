package xyz.game.datamanage.controller.publicapi.combatdata;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.combatdata.type.CombatTypeService;

@RestController
@RequestMapping("/api/games/{gameId}/combat-data")
public class CombatDataTypePublicController {

    private final CombatTypeService service;

    public CombatDataTypePublicController(CombatTypeService service) {
        this.service = service;
    }

    @GetMapping("/state")
    public ObjectNode getState(@PathVariable("gameId") String gameId) {
        return service.getState(gameId);
    }

    @GetMapping("/progression-schema")
    public ObjectNode getProgressionSchema(@PathVariable("gameId") String gameId) {
        return service.getProgressionSchema(gameId);
    }

    @GetMapping("/attribute-definitions")
    public ObjectNode listAttributeDefinitions(@PathVariable("gameId") String gameId) {
        return service.listAttributeDefinitions(gameId);
    }

    @GetMapping("/types")
    public ObjectNode listTypes(@PathVariable("gameId") String gameId) {
        return service.listTypes(gameId);
    }

    @GetMapping("/type-relations")
    public ObjectNode listTypeRelations(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "typeId", required = false) Integer typeId,
        @RequestParam(name = "targetCategory", required = false) String targetCategory,
        @RequestParam(name = "targetId", required = false) String targetId
    ) {
        return service.listTypeRelations(gameId, typeId, targetCategory, targetId);
    }
}
