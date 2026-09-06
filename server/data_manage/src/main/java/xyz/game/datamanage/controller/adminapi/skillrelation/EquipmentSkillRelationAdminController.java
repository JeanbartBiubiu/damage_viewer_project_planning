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
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationCreateRequest;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.SkillRelationUpdateRequest;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.skillrelation.SkillRelationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/equipment-skill-relations")
public class EquipmentSkillRelationAdminController {

    private final SkillRelationService service;
    private final GameDataService gameDataService;
    private final ObjectMapper objectMapper;

    public EquipmentSkillRelationAdminController(
        SkillRelationService service, GameDataService gameDataService, ObjectMapper objectMapper
    ) {
        this.service = service;
        this.gameDataService = gameDataService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public EquipmentSkillRelationListResponse list(
        @PathVariable("gameId") String gameId,
        @RequestParam(value = "equipmentKey", required = false) String equipmentKey,
        @RequestParam(value = "skillKey", required = false) String skillKey
    ) {
        return service.listEquipmentRelations(gameId, equipmentKey, skillKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public EquipmentSkillRelationResponse create(
        @PathVariable("gameId") String gameId,
        @RequestBody EquipmentSkillRelationCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        EquipmentSkillRelationResponse response = service.createEquipmentRelation(gameId, body);
        gameDataService.recordEditLog(
            auth.email(), request.getMethod(), request.getRequestURI(), objectMapper.valueToTree(body), 201
        );
        return response;
    }

    @PutMapping("/{equipmentKey}/{skillKey}")
    @Transactional
    public EquipmentSkillRelationResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("equipmentKey") String equipmentKey,
        @PathVariable("skillKey") String skillKey,
        @RequestBody SkillRelationUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        EquipmentSkillRelationResponse response = service.updateEquipmentRelation(gameId, equipmentKey, skillKey, body);
        gameDataService.recordEditLog(
            auth.email(), request.getMethod(), request.getRequestURI(), objectMapper.valueToTree(body), 200
        );
        return response;
    }

    @DeleteMapping("/{equipmentKey}/{skillKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("equipmentKey") String equipmentKey,
        @PathVariable("skillKey") String skillKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.deleteEquipmentRelation(gameId, equipmentKey, skillKey);
        gameDataService.recordEditLog(
            auth.email(), request.getMethod(), request.getRequestURI(), objectMapper.createObjectNode(), 204
        );
    }
}
