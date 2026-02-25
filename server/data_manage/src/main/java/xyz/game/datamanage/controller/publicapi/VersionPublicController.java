package xyz.game.datamanage.controller.publicapi;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.http.EtagUtil;

@RestController
@RequestMapping("/api/games/{gameId}/versions")
public class VersionPublicController {

    private final GameDataService gameDataService;

    public VersionPublicController(GameDataService gameDataService) {
        this.gameDataService = gameDataService;
    }

    @GetMapping("/current")
    public ObjectNode getCurrentVersion(@PathVariable String gameId) {
        return gameDataService.getCurrentVersion(gameId);
    }

    @GetMapping("/{versionId}/bundle")
    public ResponseEntity<ObjectNode> getBundle(
        @PathVariable String gameId,
        @PathVariable long versionId,
        @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch
    ) {
        String hash = gameDataService.getBundleDataHash(gameId, versionId);
        String etag = EtagUtil.quote(hash);
        if (EtagUtil.isNotModified(ifNoneMatch, hash)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        }
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag).body(gameDataService.getBundle(gameId, versionId));
    }
}

