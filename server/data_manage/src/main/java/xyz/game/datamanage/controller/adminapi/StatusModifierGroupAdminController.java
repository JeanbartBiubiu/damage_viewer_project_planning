package xyz.game.datamanage.controller.adminapi;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
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
@RequestMapping("/api/admin/games/{gameId}/status-modifier-groups")
public class StatusModifierGroupAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public StatusModifierGroupAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @GetMapping
    public ObjectNode listStatusModifierGroups(@PathVariable String gameId) {
        return gameDataService.listStatusModifierGroups(gameId);
    }

    @GetMapping("/{statusId}/{groupKey}")
    public ObjectNode getStatusModifierGroup(
        @PathVariable String gameId,
        @PathVariable String statusId,
        @PathVariable String groupKey
    ) {
        return gameDataService.getStatusModifierGroup(gameId, statusId, groupKey);
    }

    @PutMapping("/{statusId}/{groupKey}")
    public ObjectNode putStatusModifierGroup(
        @PathVariable String gameId,
        @PathVariable String statusId,
        @PathVariable String groupKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertStatusModifierGroup(gameId, statusId, groupKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
