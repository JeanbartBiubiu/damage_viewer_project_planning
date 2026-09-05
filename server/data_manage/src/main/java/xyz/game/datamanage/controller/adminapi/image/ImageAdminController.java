package xyz.game.datamanage.controller.adminapi.image;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.image.ImageCreateRequest;
import xyz.game.datamanage.model.image.ImageListQuery;
import xyz.game.datamanage.model.image.ImageListResponse;
import xyz.game.datamanage.model.image.ImageResponse;
import xyz.game.datamanage.model.image.ImageUpdateRequest;
import xyz.game.datamanage.service.image.ImageService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/images")
public class ImageAdminController {

    private final ImageService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public ImageAdminController(
        ImageService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public ImageListResponse list(
        @PathVariable("gameId") String gameId,
        @Valid @ModelAttribute ImageListQuery query
    ) {
        return service.list(gameId, query);
    }

    @GetMapping("/{imageKey}")
    public ImageResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("imageKey") String imageKey
    ) {
        return service.get(gameId, imageKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ImageResponse create(
        @PathVariable("gameId") String gameId,
        @RequestBody ImageCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ImageResponse response = service.create(gameId, body);
        logHelper.log(auth, request, createLogBody(body), HttpStatus.CREATED.value());
        return response;
    }

    @PutMapping("/{imageKey}")
    public ImageResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("imageKey") String imageKey,
        @RequestBody ImageUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ImageResponse response = service.update(gameId, imageKey, body);
        logHelper.log(auth, request, updateLogBody(imageKey, body), HttpStatus.OK.value());
        return response;
    }

    private ObjectNode createLogBody(ImageCreateRequest body) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("imageKey", body.imageKey());
        node.put("name", body.name());
        putNullable(node, "description", body.description());
        node.put("enabled", true);
        node.put("imageReplaced", true);
        return node;
    }

    private ObjectNode updateLogBody(String imageKey, ImageUpdateRequest body) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("imageKey", imageKey);
        node.put("name", body.name());
        putNullable(node, "description", body.description());
        node.put("enabled", Boolean.TRUE.equals(body.enabled()));
        node.put("imageReplaced", body.replacesContent());
        return node;
    }

    private static void putNullable(ObjectNode node, String field, String value) {
        if (value == null) {
            node.putNull(field);
        } else {
            node.put(field, value);
        }
    }
}
