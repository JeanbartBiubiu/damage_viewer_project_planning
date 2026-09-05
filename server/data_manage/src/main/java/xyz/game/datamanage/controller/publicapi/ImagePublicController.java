package xyz.game.datamanage.controller.publicapi;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.image.ImagePublicListResponse;
import xyz.game.datamanage.service.image.ImageService;

@RestController
@RequestMapping("/api/games/{gameId}/images")
public class ImagePublicController {

    private final ImageService imageService;

    public ImagePublicController(ImageService imageService) {
        this.imageService = imageService;
    }

    @GetMapping
    public ImagePublicListResponse getImages(
        @PathVariable("gameId") String gameId,
        @RequestParam(name = "updatedAfter", required = false) String updatedAfter
    ) {
        return imageService.listPublic(gameId, updatedAfter);
    }
}
