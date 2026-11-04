package xyz.game.datamanage.controller.adminapi;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.AuthContext;

class AdminEditLogHelperTest {

    @Test
    void logIsFailOpenWhenEditLogPersistenceFails() {
        GameDataService gameDataService = mock(GameDataService.class);
        AdminEditLogHelper helper = new AdminEditLogHelper(gameDataService);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getMethod()).thenReturn("PUT");
        when(request.getRequestURI()).thenReturn("/api/admin/games/lol/attributes");

        doThrow(new RuntimeException("db unavailable"))
            .when(gameDataService)
            .recordEditLog(org.mockito.ArgumentMatchers.any(java.util.UUID.class), anyString(), anyString(), anyString(), any(), anyInt());

        AuthContext auth = new AuthContext(java.util.UUID.fromString("00000000-0000-4000-8000-000000000001"), "fixture_author", true, java.util.UUID.fromString("00000000-0000-4000-8000-000000000002"), 1, java.time.Instant.parse("2099-01-01T00:00:00Z"));
        ObjectNode body = JsonNodeFactory.instance.objectNode().put("name", "Ahri");

        assertDoesNotThrow(() -> helper.log(auth, request, body, 200));
        verify(gameDataService).recordEditLog(org.mockito.ArgumentMatchers.any(java.util.UUID.class), anyString(), anyString(), anyString(), any(), anyInt());
    }
}
