package xyz.game.datamanage.controller.adminapi.skilleffect;

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
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.service.skilleffect.SkillEffectService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/skills/{skillKey}/effects")
public class SkillEffectAdminController {

    private final SkillEffectService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public SkillEffectAdminController(
        SkillEffectService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public List<SkillEffectSummaryResponse> list(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey
    ) {
        return service.list(gameId, skillKey);
    }

    @GetMapping("/{effectKey}")
    public SkillEffectDetailResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("effectKey") String effectKey
    ) {
        return service.get(gameId, skillKey, effectKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SkillEffectDetailResponse create(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @Valid @RequestBody SkillEffectCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillEffectDetailResponse response = service.create(gameId, skillKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{effectKey}")
    public SkillEffectDetailResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("effectKey") String effectKey,
        @Valid @RequestBody SkillEffectUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillEffectDetailResponse response = service.update(gameId, skillKey, effectKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{effectKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("effectKey") String effectKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.delete(gameId, skillKey, effectKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
