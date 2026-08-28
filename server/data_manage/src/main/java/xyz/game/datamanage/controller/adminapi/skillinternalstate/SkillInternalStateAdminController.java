package xyz.game.datamanage.controller.adminapi.skillinternalstate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCreateRequest;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetailResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateSummaryResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateUpdateRequest;
import xyz.game.datamanage.service.skillinternalstate.SkillInternalStateService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/skills/{skillKey}/internal-states")
public class SkillInternalStateAdminController {

    private final SkillInternalStateService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public SkillInternalStateAdminController(
        SkillInternalStateService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public List<SkillInternalStateSummaryResponse> list(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey
    ) {
        return service.list(gameId, skillKey);
    }

    @GetMapping("/{stateKey}")
    public SkillInternalStateDetailResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("stateKey") String stateKey
    ) {
        return service.get(gameId, skillKey, stateKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SkillInternalStateDetailResponse create(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @Valid @RequestBody SkillInternalStateCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillInternalStateDetailResponse response = service.create(gameId, skillKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{stateKey}")
    public SkillInternalStateDetailResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("stateKey") String stateKey,
        @Valid @RequestBody SkillInternalStateUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillInternalStateDetailResponse response = service.update(gameId, skillKey, stateKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{stateKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("stateKey") String stateKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.delete(gameId, skillKey, stateKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
