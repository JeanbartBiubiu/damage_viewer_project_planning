package xyz.game.datamanage.controller.adminapi;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}")
public class WasmCatalogSourceAdminController {

    private final GameDataService gameDataService;
    private final AdminEditLogHelper logHelper;

    public WasmCatalogSourceAdminController(GameDataService gameDataService, AdminEditLogHelper logHelper) {
        this.gameDataService = gameDataService;
        this.logHelper = logHelper;
    }

    @GetMapping("wasm-catalog-source")
    public ObjectNode getWasmCatalogSource(@PathVariable("gameId") String gameId) {
        return gameDataService.getWasmCatalogSource(gameId);
    }

    @PutMapping("wasm-catalog-source")
    public ObjectNode putWasmCatalogSource(
        @PathVariable("gameId") String gameId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.upsertWasmCatalogSource(gameId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }

    @PostMapping("wasm-catalog-source:bootstrap-legacy-adc")
    public ObjectNode bootstrapLegacyAdcWasmCatalogSource(
        @PathVariable("gameId") String gameId,
        @RequestBody ObjectNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        ObjectNode response = gameDataService.bootstrapLegacyAdcWasmCatalogSource(gameId, body);
        logHelper.log(auth, request, body, 200);
        return response;
    }
}
