package xyz.game.datamanage.controller.adminapi.skillrelation;

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
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationCreateRequest;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.SkillRelationUpdateRequest;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.skillrelation.RuneRelationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/rune-skill-relations")
public class RuneSkillRelationAdminController {

    private final RuneRelationService service;
    private final GameDataService gameDataService;
    private final ObjectMapper objectMapper;

    public RuneSkillRelationAdminController(
        RuneRelationService service, GameDataService gameDataService, ObjectMapper objectMapper
    ) {
        this.service = service;
        this.gameDataService = gameDataService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public RuneSkillRelationListResponse list(
        @PathVariable("gameId") String gameId,
        @RequestParam(value = "runeKey", required = false) String runeKey,
        @RequestParam(value = "skillKey", required = false) String skillKey
    ) {
        return service.listRuneRelations(gameId, runeKey, skillKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public RuneSkillRelationResponse create(
        @PathVariable("gameId") String gameId,
        @RequestBody RuneSkillRelationCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        RuneSkillRelationResponse response = service.createRuneRelation(gameId, body);
        gameDataService.recordEditLog(
            auth.email(), request.getMethod(), request.getRequestURI(), objectMapper.valueToTree(body), 201
        );
        return response;
    }

    @PutMapping("/{runeKey}/{skillKey}")
    @Transactional
    public RuneSkillRelationResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("runeKey") String runeKey,
        @PathVariable("skillKey") String skillKey,
        @RequestBody SkillRelationUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        RuneSkillRelationResponse response = service.updateRuneRelation(gameId, runeKey, skillKey, body);
        gameDataService.recordEditLog(
            auth.email(), request.getMethod(), request.getRequestURI(), objectMapper.valueToTree(body), 200
        );
        return response;
    }

    @DeleteMapping("/{runeKey}/{skillKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("runeKey") String runeKey,
        @PathVariable("skillKey") String skillKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.deleteRuneRelation(gameId, runeKey, skillKey);
        gameDataService.recordEditLog(
            auth.email(), request.getMethod(), request.getRequestURI(), objectMapper.createObjectNode(), 204
        );
    }
}
