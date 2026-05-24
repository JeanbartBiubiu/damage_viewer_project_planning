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
@RequestMapping("/api/admin/games/{gameId}/formula-bindings")
public class FormulaBindingAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public FormulaBindingAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @GetMapping
    public ObjectNode listFormulaBindings(@PathVariable("gameId") String gameId) {
        return gameDataService.listFormulaBindings(gameId);
    }

    @GetMapping("/{targetCategory}/{targetId}/{bindingKey}")
    public ObjectNode getFormulaBinding(
        @PathVariable("gameId") String gameId,
        @PathVariable("targetCategory") String targetCategory,
        @PathVariable("targetId") String targetId,
        @PathVariable("bindingKey") String bindingKey
    ) {
        return gameDataService.getFormulaBinding(gameId, targetCategory, targetId, bindingKey);
    }

    @PutMapping("/{targetCategory}/{targetId}/{bindingKey}")
    public ObjectNode putFormulaBinding(
        @PathVariable("gameId") String gameId,
        @PathVariable("targetCategory") String targetCategory,
        @PathVariable("targetId") String targetId,
        @PathVariable("bindingKey") String bindingKey,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertFormulaBinding(gameId, targetCategory, targetId, bindingKey, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
