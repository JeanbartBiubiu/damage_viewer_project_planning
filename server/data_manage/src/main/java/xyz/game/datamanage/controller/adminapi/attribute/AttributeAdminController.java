package xyz.game.datamanage.controller.adminapi.attribute;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import xyz.game.datamanage.model.attribute.AttributeCreateRequest;
import xyz.game.datamanage.model.attribute.AttributeListQuery;
import xyz.game.datamanage.model.attribute.AttributeListResponse;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeUpdateRequest;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/attributes")
public class AttributeAdminController {

    private final AttributeService attributeService;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public AttributeAdminController(
        AttributeService attributeService,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.attributeService = attributeService;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public AttributeListResponse list(
        @PathVariable("gameId") String gameId,
        @Valid @ModelAttribute AttributeListQuery query
    ) {
        return attributeService.list(gameId, query);
    }

    @GetMapping("/{attributeKey}")
    public AttributeResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("attributeKey") String attributeKey
    ) {
        return attributeService.get(gameId, attributeKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AttributeResponse create(
        @PathVariable("gameId") String gameId,
        @Valid @RequestBody AttributeCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        AttributeResponse response = attributeService.create(gameId, body);
        JsonNode auditBody = objectMapper.valueToTree(body);
        logHelper.log(auth, request, auditBody, HttpStatus.CREATED.value());
        return response;
    }

    @PutMapping("/{attributeKey}")
    public AttributeResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("attributeKey") String attributeKey,
        @Valid @RequestBody AttributeUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        AttributeResponse response = attributeService.update(gameId, attributeKey, body);
        JsonNode auditBody = objectMapper.valueToTree(body);
        logHelper.log(auth, request, auditBody, HttpStatus.OK.value());
        return response;
    }
}
