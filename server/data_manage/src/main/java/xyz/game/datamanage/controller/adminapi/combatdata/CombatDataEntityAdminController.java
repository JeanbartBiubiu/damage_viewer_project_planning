package xyz.game.datamanage.controller.adminapi.combatdata;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.service.combatdata.entity.EntityCombatDataService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/combat-data")
public class CombatDataEntityAdminController {

    private final EntityCombatDataService service;
    private final AdminEditLogHelper logHelper;

    public CombatDataEntityAdminController(EntityCombatDataService service, AdminEditLogHelper logHelper) {
        this.service = service;
        this.logHelper = logHelper;
    }

    @PutMapping("/entities/{entityId}")
    public ObjectNode putEntity(
        @PathVariable("gameId") String gameId,
        @PathVariable("entityId") String entityId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putEntity(gameId, entityId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/entities/{entityId}/attributes/{attrKey}")
    public ObjectNode putEntityAttribute(
        @PathVariable("gameId") String gameId,
        @PathVariable("entityId") String entityId,
        @PathVariable("attrKey") String attrKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putEntityAttribute(gameId, entityId, attrKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/entities/{entityId}/attributes/{attrKey}/stages/{stage}")
    public ObjectNode putEntityAttributeStage(
        @PathVariable("gameId") String gameId,
        @PathVariable("entityId") String entityId,
        @PathVariable("attrKey") String attrKey,
        @PathVariable("stage") int stage,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putEntityAttributeStage(gameId, entityId, attrKey, stage, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/entities/{entityId}/provider-mounts/{providerId}")
    public ObjectNode putEntityProviderMount(
        @PathVariable("gameId") String gameId,
        @PathVariable("entityId") String entityId,
        @PathVariable("providerId") String providerId,
        @RequestBody(required = false) ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putEntityProviderMount(gameId, entityId, providerId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    /**
     * Sole entity-editor aggregate write: atomic upsert of metadata + submitted attributes/mounts
     * under one optimistic-concurrency revision. Generic batch/delete remain absent.
     */
    @PutMapping("/entities/{entityId}:batch")
    public ObjectNode putEntityBatch(
        @PathVariable("gameId") String gameId,
        @PathVariable("entityId") String entityId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putEntityBatch(gameId, entityId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
