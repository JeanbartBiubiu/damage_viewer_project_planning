package xyz.game.datamanage.controller.adminapi;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
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
@RequestMapping("/api/admin/games/{gameId}/formula-profiles")
public class FormulaProfileAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public FormulaProfileAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @GetMapping
    public ObjectNode listFormulaProfiles(@PathVariable String gameId) {
        return gameDataService.listFormulaProfiles(gameId);
    }

    @GetMapping("/{formulaId}")
    public ObjectNode getFormulaProfile(@PathVariable String gameId, @PathVariable String formulaId) {
        return gameDataService.getFormulaProfile(gameId, formulaId);
    }

    @PutMapping("/{formulaId}")
    public ObjectNode putFormulaProfile(
        @PathVariable String gameId,
        @PathVariable String formulaId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertFormulaProfile(gameId, formulaId, body, false);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PatchMapping("/{formulaId}")
    public ObjectNode patchFormulaProfile(
        @PathVariable String gameId,
        @PathVariable String formulaId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertFormulaProfile(gameId, formulaId, body, true);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
