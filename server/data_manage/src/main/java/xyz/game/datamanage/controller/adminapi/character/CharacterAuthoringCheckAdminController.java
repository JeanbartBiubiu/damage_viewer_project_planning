package xyz.game.datamanage.controller.adminapi.character;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckResponse;
import xyz.game.datamanage.service.character.CharacterAuthoringCheckService;

@RestController
@RequestMapping("/api/admin/games/{gameId}/characters/{characterKey}/authoring-check")
public class CharacterAuthoringCheckAdminController {
    private final CharacterAuthoringCheckService service;

    public CharacterAuthoringCheckAdminController(CharacterAuthoringCheckService service) {
        this.service = service;
    }

    @GetMapping
    public CharacterAuthoringCheckResponse check(@PathVariable("gameId") String gameId,
                                                @PathVariable("characterKey") String characterKey) {
        return service.check(gameId, characterKey);
    }
}
