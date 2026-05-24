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
@RequestMapping("/api/admin/games/{gameId}/status-periodic-hp-effects")
public class StatusPeriodicHpEffectAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public StatusPeriodicHpEffectAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @GetMapping
    public ObjectNode listStatusPeriodicHpEffects(@PathVariable("gameId") String gameId) {
        return gameDataService.listStatusPeriodicHpEffects(gameId);
    }

    @GetMapping("/{statusId}/{groupKey}/{effectId}")
    public ObjectNode getStatusPeriodicHpEffect(
        @PathVariable("gameId") String gameId,
        @PathVariable("statusId") String statusId,
        @PathVariable("groupKey") String groupKey,
        @PathVariable("effectId") String effectId
    ) {
        return gameDataService.getStatusPeriodicHpEffect(gameId, statusId, groupKey, effectId);
    }

    @PutMapping("/{statusId}/{groupKey}/{effectId}")
    public ObjectNode putStatusPeriodicHpEffect(
        @PathVariable("gameId") String gameId,
        @PathVariable("statusId") String statusId,
        @PathVariable("groupKey") String groupKey,
        @PathVariable("effectId") String effectId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertStatusPeriodicHpEffect(gameId, statusId, groupKey, effectId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
