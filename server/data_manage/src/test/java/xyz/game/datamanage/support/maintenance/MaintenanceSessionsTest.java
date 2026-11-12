package xyz.game.datamanage.support.maintenance;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import xyz.game.datamanage.support.account.AccountStore;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

class MaintenanceSessionsTest {
    @TempDir Path directory;
    @Test void maintenanceAndDeploymentCredentialsDoNotAuthorizeEachOther() throws Exception {
        var properties=new MaintenanceProperties();properties.setTokenPath(directory.resolve("maintenance"));properties.setDeploymentTokenPath(directory.resolve("deployment"));
        Files.writeString(properties.getTokenPath(),"m".repeat(43));Files.writeString(properties.getDeploymentTokenPath(),"d".repeat(43));
        var sessions=new MaintenanceSessions(mock(AccountStore.class),properties);var request=new MockHttpServletRequest();request.setRemoteAddr("127.0.0.1");
        request.addHeader("X-Damage-Maintenance-Token","m".repeat(43));assertDoesNotThrow(()->sessions.credential(request,false));
        assertThrows(ApiException.class,()->sessions.credential(request,true));request.removeHeader("X-Damage-Maintenance-Token");request.addHeader("X-Damage-Deployment-Token","d".repeat(43));
        assertDoesNotThrow(()->sessions.credential(request,true));assertThrows(ApiException.class,()->sessions.credential(request,false));
    }
    @Test void forwardedAddressCannotTurnAnUntrustedCallerIntoMaintenance() throws Exception {
        var properties=new MaintenanceProperties();properties.setTokenPath(directory.resolve("maintenance"));Files.writeString(properties.getTokenPath(),"m".repeat(43));
        var sessions=new MaintenanceSessions(mock(AccountStore.class),properties);var request=new MockHttpServletRequest();request.setRemoteAddr("203.0.113.1");
        request.addHeader("X-Forwarded-For","127.0.0.1");request.addHeader("X-Damage-Maintenance-Token","m".repeat(43));assertThrows(ApiException.class,()->sessions.credential(request,false));
    }
    @Test void missingOriginIsAControlledRejectionRatherThanInternalError() {
        var sessions=new MaintenanceSessions(mock(AccountStore.class),new MaintenanceProperties());var request=new MockHttpServletRequest();request.setContentType("application/json");request.addHeader("X-Damage-Client","web");
        assertEquals(403,assertThrows(ApiException.class,()->sessions.mutation(request)).getStatus().value());
        request.addHeader("Origin","https://localhost:5174");assertDoesNotThrow(()->sessions.mutation(request));
    }
}
