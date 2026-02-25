package xyz.game.datamanage.controller.publicapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.http.EtagUtil;

@RestController
@RequestMapping("/api/games")
public class GamePublicController {

    private final GameDataService gameDataService;
    private final ObjectMapper objectMapper;

    public GamePublicController(GameDataService gameDataService, ObjectMapper objectMapper) {
        this.gameDataService = gameDataService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public ResponseEntity<ArrayNode> listGames(
        @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch
    ) {
        ArrayNode response = gameDataService.listGames();
        String etagValue = EtagUtil.hashJson(response, objectMapper);
        String etag = EtagUtil.quote(etagValue);
        if (EtagUtil.isNotModified(ifNoneMatch, etagValue)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        }
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag).body(response);
    }
}

