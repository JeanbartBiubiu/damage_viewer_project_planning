package xyz.game.datamanage.controller.adminapi.skillrelation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.skillrelation.BuildOptionSkillRelationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/build-option-skill-relations")
public class BuildOptionSkillRelationAdminController {
    private final BuildOptionSkillRelationService service;
    private final GameDataService gameDataService;
    private final ObjectMapper objectMapper;

    public BuildOptionSkillRelationAdminController(
        BuildOptionSkillRelationService service, GameDataService gameDataService, ObjectMapper objectMapper
    ) {
        this.service = service;
        this.gameDataService = gameDataService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public BuildOptionSkillRelationListResponse list(
        @PathVariable("gameId") String gameId,
        @RequestParam(value = "systemKey", required = false) String systemKey,
        @RequestParam(value = "optionKey", required = false) String optionKey,
        @RequestParam(value = "skillKey", required = false) String skillKey
    ) {
        return service.list(gameId, systemKey, optionKey, skillKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public BuildOptionSkillRelationResponse create(
        @PathVariable("gameId") String gameId, @RequestBody JsonNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request
    ) {
        BuildOptionSkillRelationResponse response = service.create(gameId, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 201);
        return response;
    }

    @PutMapping("/{systemKey}/{optionKey}/{skillKey}")
    @Transactional
    public BuildOptionSkillRelationResponse update(
        @PathVariable("gameId") String gameId, @PathVariable("systemKey") String systemKey,
        @PathVariable("optionKey") String optionKey, @PathVariable("skillKey") String skillKey, @RequestBody JsonNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request
    ) {
        BuildOptionSkillRelationResponse response = service.update(gameId, systemKey, optionKey, skillKey, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 200);
        return response;
    }

    @DeleteMapping("/{systemKey}/{optionKey}/{skillKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(
        @PathVariable("gameId") String gameId, @PathVariable("systemKey") String systemKey,
        @PathVariable("optionKey") String optionKey, @PathVariable("skillKey") String skillKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request
    ) {
        service.delete(gameId, systemKey, optionKey, skillKey);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(),
            objectMapper.createObjectNode(), 204);
    }
}
