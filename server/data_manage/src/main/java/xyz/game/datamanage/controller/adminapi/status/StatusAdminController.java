package xyz.game.datamanage.controller.adminapi.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
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
import xyz.game.datamanage.model.status.StatusCreateRequest;
import xyz.game.datamanage.model.status.StatusListQuery;
import xyz.game.datamanage.model.status.StatusListResponse;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.model.status.StatusUpdateRequest;
import xyz.game.datamanage.service.status.StatusService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/statuses")
public class StatusAdminController {

    private final StatusService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public StatusAdminController(
        StatusService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public StatusListResponse list(
        @PathVariable("gameId") String gameId,
        @Valid @ModelAttribute StatusListQuery query
    ) {
        return service.list(gameId, query);
    }

    @GetMapping("/{statusKey}")
    public StatusResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("statusKey") String statusKey
    ) {
        return service.get(gameId, statusKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public StatusResponse create(
        @PathVariable("gameId") String gameId,
        @Valid @RequestBody StatusCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        StatusResponse response = service.create(gameId, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{statusKey}")
    public StatusResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("statusKey") String statusKey,
        @Valid @RequestBody StatusUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        StatusResponse response = service.update(gameId, statusKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{statusKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("statusKey") String statusKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.delete(gameId, statusKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
