package xyz.game.datamanage.controller.adminapi.skillparameter;

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
import xyz.game.datamanage.model.skillparameter.SkillParameterCreateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterUpdateRequest;
import xyz.game.datamanage.service.skillparameter.SkillParameterService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/skills/{skillKey}/parameters")
public class SkillParameterAdminController {

    private final SkillParameterService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public SkillParameterAdminController(
        SkillParameterService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public List<SkillParameterResponse> list(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey
    ) {
        return service.list(gameId, skillKey);
    }

    @GetMapping("/{parameterKey}")
    public SkillParameterResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("parameterKey") String parameterKey
    ) {
        return service.get(gameId, skillKey, parameterKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SkillParameterResponse create(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @Valid @RequestBody SkillParameterCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillParameterResponse response = service.create(gameId, skillKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{parameterKey}")
    public SkillParameterResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("parameterKey") String parameterKey,
        @Valid @RequestBody SkillParameterUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillParameterResponse response = service.update(gameId, skillKey, parameterKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{parameterKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("parameterKey") String parameterKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.delete(gameId, skillKey, parameterKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
