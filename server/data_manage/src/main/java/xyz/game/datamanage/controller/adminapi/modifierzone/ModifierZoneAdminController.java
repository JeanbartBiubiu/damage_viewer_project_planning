package xyz.game.datamanage.controller.adminapi.modifierzone;

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
import xyz.game.datamanage.model.modifierzone.ModifierZoneCreateRequest;
import xyz.game.datamanage.model.modifierzone.ModifierZoneListQuery;
import xyz.game.datamanage.model.modifierzone.ModifierZoneListResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneUpdateRequest;
import xyz.game.datamanage.service.modifierzone.ModifierZoneService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/modifier-zones")
public class ModifierZoneAdminController {

    private final ModifierZoneService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public ModifierZoneAdminController(
        ModifierZoneService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public ModifierZoneListResponse list(
        @PathVariable("gameId") String gameId,
        @Valid @ModelAttribute ModifierZoneListQuery query
    ) {
        return service.list(gameId, query);
    }

    @GetMapping("/{modifierZoneKey}")
    public ModifierZoneResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("modifierZoneKey") String modifierZoneKey
    ) {
        return service.get(gameId, modifierZoneKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ModifierZoneResponse create(
        @PathVariable("gameId") String gameId,
        @Valid @RequestBody ModifierZoneCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ModifierZoneResponse response = service.create(gameId, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{modifierZoneKey}")
    public ModifierZoneResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("modifierZoneKey") String modifierZoneKey,
        @Valid @RequestBody ModifierZoneUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ModifierZoneResponse response = service.update(gameId, modifierZoneKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{modifierZoneKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("modifierZoneKey") String modifierZoneKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.delete(gameId, modifierZoneKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
