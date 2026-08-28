package xyz.game.datamanage.controller.adminapi.skillprocess;

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
import xyz.game.datamanage.model.skillprocess.SkillProcessCreateRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessDetailResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessSummaryResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessUpdateRequest;
import xyz.game.datamanage.service.skillprocess.SkillProcessService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/skills/{skillKey}/processes")
public class SkillProcessAdminController {

    private final SkillProcessService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public SkillProcessAdminController(
        SkillProcessService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public List<SkillProcessSummaryResponse> list(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey
    ) {
        return service.list(gameId, skillKey);
    }

    @GetMapping("/{processKey}")
    public SkillProcessDetailResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("processKey") String processKey
    ) {
        return service.get(gameId, skillKey, processKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SkillProcessDetailResponse create(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @Valid @RequestBody SkillProcessCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillProcessDetailResponse response = service.create(gameId, skillKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{processKey}")
    public SkillProcessDetailResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("processKey") String processKey,
        @Valid @RequestBody SkillProcessUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillProcessDetailResponse response = service.update(gameId, skillKey, processKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{processKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("processKey") String processKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.delete(gameId, skillKey, processKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
