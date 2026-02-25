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
@RequestMapping("/api/admin/games/{gameId}/type-relations")
public class TypeRelationAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public TypeRelationAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @PutMapping("/{typeId}/{targetCategory}/{targetId}")
    public ObjectNode putTypeRelation(
        @PathVariable String gameId,
        @PathVariable int typeId,
        @PathVariable String targetCategory,
        @PathVariable String targetId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertTypeRelation(gameId, typeId, targetCategory, targetId, body, false);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PatchMapping("/{typeId}/{targetCategory}/{targetId}")
    public ObjectNode patchTypeRelation(
        @PathVariable String gameId,
        @PathVariable int typeId,
        @PathVariable String targetCategory,
        @PathVariable String targetId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertTypeRelation(gameId, typeId, targetCategory, targetId, body, true);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}

