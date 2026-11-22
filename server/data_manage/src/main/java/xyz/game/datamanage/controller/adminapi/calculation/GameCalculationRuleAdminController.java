package xyz.game.datamanage.controller.adminapi.calculation;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.calculation.GameCalculationRulesResponse;
import xyz.game.datamanage.service.calculation.GameCalculationRuleService;
import xyz.game.datamanage.support.maintenance.MaintenancePrincipal;

@RestController
@RequestMapping("/api/admin/games/{gameId}/calculation-rules")
public class GameCalculationRuleAdminController {
    private final GameCalculationRuleService service;
    private final AdminEditLogHelper logs;

    public GameCalculationRuleAdminController(GameCalculationRuleService service, AdminEditLogHelper logs) {
        this.service = service; this.logs = logs;
    }

    @GetMapping
    public GameCalculationRulesResponse get(@PathVariable String gameId) { return service.get(gameId); }

    @PutMapping
    public GameCalculationRulesResponse replace(@PathVariable String gameId, @RequestBody JsonNode request,
                                                @RequestAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE) MaintenancePrincipal auth,
                                                HttpServletRequest servletRequest) {
        GameCalculationRulesResponse result = service.replace(gameId, request);
        logs.log(auth, servletRequest, request, 200);
        return result;
    }
}
