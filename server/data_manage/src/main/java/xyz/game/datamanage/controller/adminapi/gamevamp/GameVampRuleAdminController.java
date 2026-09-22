package xyz.game.datamanage.controller.adminapi.gamevamp;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.service.gamevamp.GameVampRuleService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/vamp-rules")
public class GameVampRuleAdminController {
    private final GameVampRuleService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper json;

    public GameVampRuleAdminController(GameVampRuleService service, AdminEditLogHelper logHelper, ObjectMapper json) {
        this.service = service; this.logHelper = logHelper; this.json = json;
    }

    @GetMapping
    public GameVampRules get(@PathVariable String gameId) { return service.get(gameId); }

    @PutMapping
    public GameVampRules replace(@PathVariable String gameId, @Valid @RequestBody GameVampRules request,
                                @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
                                HttpServletRequest servletRequest) {
        GameVampRules response = service.replace(gameId, request);
        logHelper.log(auth, servletRequest, json.valueToTree(request), 200);
        return response;
    }
}
