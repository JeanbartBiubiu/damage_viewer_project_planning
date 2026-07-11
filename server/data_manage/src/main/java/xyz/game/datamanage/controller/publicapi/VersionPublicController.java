package xyz.game.datamanage.controller.publicapi;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.GameDataService;

@RestController
@RequestMapping("/api/games/{gameId}/versions")
public class VersionPublicController {

    private final GameDataService gameDataService;

    public VersionPublicController(GameDataService gameDataService) {
        this.gameDataService = gameDataService;
    }

    @GetMapping("/current")
    public ObjectNode getCurrentVersion(@PathVariable("gameId") String gameId) {
        return gameDataService.getCurrentVersion(gameId);
    }

    @GetMapping("/{versionCode}/bundle")
    public ResponseEntity<ObjectNode> getBundle(@PathVariable("gameId") String gameId, @PathVariable("versionCode") String versionCode) {
        return ResponseEntity.ok(gameDataService.getBundle(gameId, versionCode));
    }

    @GetMapping("/{versionCode}/wasm-catalog")
    public ResponseEntity<ObjectNode> getWasmCatalog(
        @PathVariable("gameId") String gameId,
        @PathVariable("versionCode") String versionCode
    ) {
        return ResponseEntity.ok(gameDataService.getWasmCatalog(gameId, versionCode));
    }
}
