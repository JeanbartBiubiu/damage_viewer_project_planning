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
@RequestMapping("/api/admin/games/{gameId}/status-attribute-modifiers")
public class StatusAttributeModifierAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public StatusAttributeModifierAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @GetMapping
    public ObjectNode listStatusAttributeModifiers(@PathVariable("gameId") String gameId) {
        return gameDataService.listStatusAttributeModifiers(gameId);
    }

    @GetMapping("/{statusId}/{groupKey}/{modifierId}")
    public ObjectNode getStatusAttributeModifier(
        @PathVariable("gameId") String gameId,
        @PathVariable("statusId") String statusId,
        @PathVariable("groupKey") String groupKey,
        @PathVariable("modifierId") String modifierId
    ) {
        return gameDataService.getStatusAttributeModifier(gameId, statusId, groupKey, modifierId);
    }

    @PutMapping("/{statusId}/{groupKey}/{modifierId}")
    public ObjectNode putStatusAttributeModifier(
        @PathVariable("gameId") String gameId,
        @PathVariable("statusId") String statusId,
        @PathVariable("groupKey") String groupKey,
        @PathVariable("modifierId") String modifierId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertStatusAttributeModifier(gameId, statusId, groupKey, modifierId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
