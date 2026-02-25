package xyz.game.datamanage.controller.publicapi;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.GameDataService;

@RestController
@RequestMapping("/api/games/{gameId}/images")
public class ImagePublicController {

    private final GameDataService gameDataService;

    public ImagePublicController(GameDataService gameDataService) {
        this.gameDataService = gameDataService;
    }

    @GetMapping
    public ObjectNode getImages(
        @PathVariable String gameId,
        @RequestParam(name = "updatedAfter", required = false) String updatedAfter
    ) {
        return gameDataService.getImages(gameId, updatedAfter);
    }
}

