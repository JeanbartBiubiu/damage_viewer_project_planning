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
@RequestMapping("/api/admin/games/{gameId}/status-action-control-rules")
public class StatusActionControlRuleAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public StatusActionControlRuleAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @GetMapping
    public ObjectNode listStatusActionControlRules(@PathVariable("gameId") String gameId) {
        return gameDataService.listStatusActionControlRules(gameId);
    }

    @GetMapping("/{ruleId}")
    public ObjectNode getStatusActionControlRule(@PathVariable("gameId") String gameId, @PathVariable("ruleId") String ruleId) {
        return gameDataService.getStatusActionControlRule(gameId, ruleId);
    }

    @PutMapping("/{ruleId}")
    public ObjectNode putStatusActionControlRule(
        @PathVariable("gameId") String gameId,
        @PathVariable("ruleId") String ruleId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertStatusActionControlRule(gameId, ruleId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
