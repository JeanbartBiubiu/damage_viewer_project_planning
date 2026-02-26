package xyz.game.datamanage.controller.adminapi;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.AuthContext;

@Component
public class AdminEditLogHelper {

    private static final Logger log = LoggerFactory.getLogger(AdminEditLogHelper.class);

    private final GameDataService gameDataService;

    public AdminEditLogHelper(GameDataService gameDataService) {
        this.gameDataService = gameDataService;
    }

    public void log(AuthContext auth, HttpServletRequest request, JsonNode body, int responseCode) {
        try {
            gameDataService.recordEditLog(
                auth.email(),
                request.getMethod(),
                request.getRequestURI(),
                body,
                responseCode
            );
        } catch (RuntimeException ex) {
            // Fail-open policy: edit_log failure must not block admin write responses.
            log.warn(
                "Admin edit log write failed and was skipped. email={}, method={}, path={}, responseCode={}",
                auth.email(),
                request.getMethod(),
                request.getRequestURI(),
                responseCode,
                ex
            );
        }
    }
}
