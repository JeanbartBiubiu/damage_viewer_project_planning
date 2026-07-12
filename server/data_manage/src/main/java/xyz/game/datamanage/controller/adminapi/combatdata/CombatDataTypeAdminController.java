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
import xyz.game.datamanage.service.combatdata.type.CombatTypeService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/combat-data")
public class CombatDataTypeAdminController {

    private final CombatTypeService service;
    private final AdminEditLogHelper logHelper;

    public CombatDataTypeAdminController(CombatTypeService service, AdminEditLogHelper logHelper) {
        this.service = service;
        this.logHelper = logHelper;
    }

    @PutMapping("/progression-schema")
    public ObjectNode putProgressionSchema(
        @PathVariable("gameId") String gameId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putProgressionSchema(gameId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/attribute-definitions/{attrKey}")
    public ObjectNode putAttributeDefinition(
        @PathVariable("gameId") String gameId,
        @PathVariable("attrKey") String attrKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putAttributeDefinition(gameId, attrKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/resource-definitions/{resourceKey}")
    public ObjectNode putResourceDefinition(
        @PathVariable("gameId") String gameId,
        @PathVariable("resourceKey") String resourceKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putResourceDefinition(gameId, resourceKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/types/{typeId}")
    public ObjectNode putType(
        @PathVariable("gameId") String gameId,
        @PathVariable("typeId") int typeId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putType(gameId, typeId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PutMapping("/type-relations/{typeId}/{targetCategory}/{targetId}")
    public ObjectNode putTypeRelation(
        @PathVariable("gameId") String gameId,
        @PathVariable("typeId") int typeId,
        @PathVariable("targetCategory") String targetCategory,
        @PathVariable("targetId") String targetId,
        @RequestBody(required = false) ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = service.putTypeRelation(gameId, typeId, targetCategory, targetId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
