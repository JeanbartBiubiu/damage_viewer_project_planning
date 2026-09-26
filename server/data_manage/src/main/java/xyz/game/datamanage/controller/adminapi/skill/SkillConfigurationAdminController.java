package xyz.game.datamanage.controller.adminapi.skill;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest;
import xyz.game.datamanage.service.skillconfiguration.SkillConfigurationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/skills/{skillKey}/configuration")
public class SkillConfigurationAdminController {

    private final SkillConfigurationService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public SkillConfigurationAdminController(
        SkillConfigurationService service, AdminEditLogHelper logHelper, ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public SkillConfigurationResponse get(
        @PathVariable String gameId, @PathVariable String skillKey
    ) {
        return service.get(gameId, skillKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SkillConfigurationResponse create(
        @PathVariable String gameId, @PathVariable String skillKey,
        @RequestBody SkillConfigurationSaveRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillConfigurationResponse result = service.create(gameId, skillKey, body);
        logHelper.log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED.value());
        return result;
    }

    @PatchMapping
    public SkillConfigurationResponse update(
        @PathVariable String gameId, @PathVariable String skillKey,
        @RequestBody SkillConfigurationSaveRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillConfigurationResponse result = service.update(gameId, skillKey, body);
        logHelper.log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK.value());
        return result;
    }
}
