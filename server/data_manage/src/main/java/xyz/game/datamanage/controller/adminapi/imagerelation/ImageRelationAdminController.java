package xyz.game.datamanage.controller.adminapi.imagerelation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.imagerelation.ImageOptionResponse;
import xyz.game.datamanage.model.imagerelation.ImageRelationSource;
import xyz.game.datamanage.model.imagerelation.ImageUsageResponse;
import xyz.game.datamanage.model.imagerelation.RepresentativeImageRequest;
import xyz.game.datamanage.model.imagerelation.RepresentativeImageResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.imagerelation.ImageRelationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}")
public class ImageRelationAdminController {
    private final ImageRelationService service;
    private final GameDataService gameDataService;
    private final ObjectMapper objectMapper;

    public ImageRelationAdminController(
        ImageRelationService service, GameDataService gameDataService, ObjectMapper objectMapper
    ) {
        this.service = service;
        this.gameDataService = gameDataService;
        this.objectMapper = objectMapper;
    }

    @GetMapping({
        "/representative-image",
        "/characters/{characterKey}/representative-image",
        "/attributes/{attributeKey}/representative-image",
        "/equipment/{equipmentKey}/representative-image",
        "/runes/{runeKey}/representative-image",
        "/rune-paths/{pathKey}/representative-image",
        "/skills/{skillKey}/representative-image",
        "/skills/{skillKey}/effects/{effectKey}/representative-image",
        "/statuses/{statusKey}/representative-image"
    })
    public RepresentativeImageResponse get(@PathVariable Map<String, String> path) {
        Target target = target(path);
        return service.get(path.get("gameId"), target.type(), target.parent(), target.key());
    }

    @PutMapping({
        "/representative-image",
        "/characters/{characterKey}/representative-image",
        "/attributes/{attributeKey}/representative-image",
        "/equipment/{equipmentKey}/representative-image",
        "/runes/{runeKey}/representative-image",
        "/rune-paths/{pathKey}/representative-image",
        "/skills/{skillKey}/representative-image",
        "/skills/{skillKey}/effects/{effectKey}/representative-image",
        "/statuses/{statusKey}/representative-image"
    })
    @Transactional
    public RepresentativeImageResponse put(
        @PathVariable Map<String, String> path,
        @RequestBody RepresentativeImageRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        Target target = target(path);
        RepresentativeImageResponse response = service.put(path.get("gameId"), target.type(), target.parent(), target.key(), body);
        ObjectNode logBody = logBody(path.get("gameId"), target);
        logBody.put("imageKey", body.imageKey());
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), logBody, 200);
        return response;
    }

    @DeleteMapping({
        "/representative-image",
        "/characters/{characterKey}/representative-image",
        "/attributes/{attributeKey}/representative-image",
        "/equipment/{equipmentKey}/representative-image",
        "/runes/{runeKey}/representative-image",
        "/rune-paths/{pathKey}/representative-image",
        "/skills/{skillKey}/representative-image",
        "/skills/{skillKey}/effects/{effectKey}/representative-image",
        "/statuses/{statusKey}/representative-image"
    })
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(
        @PathVariable Map<String, String> path,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        Target target = target(path);
        service.delete(path.get("gameId"), target.type(), target.parent(), target.key());
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(),
            logBody(path.get("gameId"), target), 204);
    }

    @GetMapping("/images/{imageKey}/usages")
    public ImageUsageResponse usages(@PathVariable("gameId") String gameId, @PathVariable("imageKey") String imageKey) {
        return service.usages(gameId, imageKey);
    }

    @GetMapping("/image-options")
    public ImageOptionResponse options(
        @PathVariable("gameId") String gameId,
        @RequestParam(value = "keyword", required = false) String keyword
    ) {
        return service.options(gameId, keyword);
    }

    private ObjectNode logBody(String gameId, Target target) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("gameId", gameId);
        body.put("sourceType", target.type().name());
        body.put("sourceParentKey", target.parent());
        body.put("sourceKey", target.key());
        return body;
    }

    private static Target target(Map<String, String> path) {
        if (path.containsKey("effectKey")) {
            return new Target(ImageRelationSource.SKILL_EFFECT, path.get("skillKey"), path.get("effectKey"));
        }
        for (ImageRelationSource type : ImageRelationSource.values()) {
            if (type != ImageRelationSource.GAME && type != ImageRelationSource.SKILL_EFFECT && path.containsKey(type.keyField())) {
                return new Target(type, "", path.get(type.keyField()));
            }
        }
        return new Target(ImageRelationSource.GAME, "", path.get("gameId"));
    }

    private record Target(ImageRelationSource type, String parent, String key) {}
}
