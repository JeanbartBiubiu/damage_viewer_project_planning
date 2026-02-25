package xyz.game.datamanage.controller.adminapi;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.AuthContext;

@Component
public class AdminEditLogHelper {

    private final GameDataService gameDataService;

    public AdminEditLogHelper(GameDataService gameDataService) {
        this.gameDataService = gameDataService;
    }

    public void log(AuthContext auth, HttpServletRequest request, JsonNode body, int responseCode) {
        gameDataService.recordEditLog(
            auth.email(),
            request.getMethod(),
            request.getRequestURI(),
            body,
            responseCode
        );
    }
}

