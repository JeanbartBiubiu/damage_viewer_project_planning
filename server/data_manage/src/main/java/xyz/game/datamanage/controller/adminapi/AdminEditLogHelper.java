package xyz.game.datamanage.controller.adminapi;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.maintenance.MaintenancePrincipal;

@Component
public class AdminEditLogHelper {

    private final GameDataService gameDataService;

    public AdminEditLogHelper(GameDataService gameDataService) {
        this.gameDataService = gameDataService;
    }

    public void log(MaintenancePrincipal auth, HttpServletRequest request, JsonNode body, int responseCode) {
        gameDataService.recordEditLog(
                auth.principalId(),
                auth.displayName(),
                request.getMethod(),
                request.getRequestURI(),
                body,
                responseCode
        );
    }
}
