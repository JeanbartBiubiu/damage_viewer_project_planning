package xyz.game.datamanage.controller.adminapi;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/attribute-definitions")
public class AttributeDefinitionAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public AttributeDefinitionAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @PutMapping("/{attrKey}")
    public ObjectNode putAttributeDefinition(
        @PathVariable String gameId,
        @PathVariable String attrKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertAttributeDefinition(gameId, attrKey, body, false);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PatchMapping("/{attrKey}")
    public ObjectNode patchAttributeDefinition(
        @PathVariable String gameId,
        @PathVariable String attrKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertAttributeDefinition(gameId, attrKey, body, true);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}

