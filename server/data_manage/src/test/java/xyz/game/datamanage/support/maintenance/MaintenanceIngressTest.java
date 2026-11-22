package xyz.game.datamanage.support.maintenance;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import xyz.game.datamanage.support.error.ApiException;

class MaintenanceIngressTest {
    private static final String ORIGIN = "https://localhost:5174";
    private final MaintenanceProperties properties = new MaintenanceProperties();
    private final MaintenanceIngress ingress = new MaintenanceIngress(properties);

    @Test void browserReadsRequireSameOriginAndCheckAnySuppliedOrigin() {
        var request = privateRequest();
        request.addHeader("Sec-Fetch-Site", "same-origin");
        assertDoesNotThrow(() -> ingress.require(request, false));
        assertDenied(() -> ingress.require(request, true));
        request.addHeader("Origin", ORIGIN);
        assertDoesNotThrow(() -> ingress.require(request, false));
        assertDenied(() -> ingress.require(request, true));
        request.addHeader("X-Damage-Client", "web");
        assertDoesNotThrow(() -> ingress.require(request, true));
        request.removeHeader("Origin");
        request.addHeader("Origin", ORIGIN + "/");
        assertDenied(() -> ingress.require(request, false));
    }

    @Test void cliReadsAndMutationsRequireBothHeadersAndNoBrowserMarkers() {
        var request = privateRequest();
        request.addHeader("Origin", ORIGIN);
        assertDenied(() -> ingress.require(request, false));
        request.addHeader("X-Damage-Client", "web");
        assertDoesNotThrow(() -> ingress.require(request, false));
        assertDoesNotThrow(() -> ingress.require(request, true));
        request.addHeader("Sec-Fetch-Dest", "image");
        assertDenied(() -> ingress.require(request, false));
    }

    @Test void otherBrowserSitesAndAmbiguousHeadersAreDenied() {
        for (String site : List.of("same-site", "cross-site", "none", "same-origin, same-origin")) {
            var request = privateRequest();
            request.addHeader("Sec-Fetch-Site", site);
            request.addHeader("Origin", ORIGIN);
            request.addHeader("X-Damage-Client", "web");
            assertDenied(() -> ingress.require(request, false));
            assertDenied(() -> ingress.require(request, true));
        }
        var request = privateRequest();
        request.addHeader("Origin", ORIGIN);
        request.addHeader("Origin", ORIGIN);
        request.addHeader("X-Damage-Client", "web");
        assertDenied(() -> ingress.require(request, false));
    }

    @Test void deploymentCredentialRequiresThePrivateConnectorForWindowsButKeepsStatisticsOnLoopback(@TempDir Path directory) throws Exception {
        properties.setDeploymentTokenPath(directory.resolve("deployment-fixture"));
        String fixture = "d".repeat(43);
        Files.writeString(properties.getDeploymentTokenPath(), fixture);
        var deployment = new DeploymentCredential(properties, ingress);
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");
        request.addHeader("Origin", ORIGIN);
        request.addHeader("X-Damage-Client", "web");
        request.addHeader("X-Damage-Internal-Token", fixture);
        assertDenied(() -> deployment.requireStatistics(request));
        request.addHeader("X-Damage-Deployment-Token", fixture);
        assertDoesNotThrow(() -> deployment.requireStatistics(request));
        assertDenied(() -> deployment.requireWindowOperation(request));
        request.setAttribute(MaintenanceIngress.PRIVATE_CONNECTOR_ATTRIBUTE, true);
        assertDoesNotThrow(() -> deployment.requireWindowOperation(request));
    }

    private static MockHttpServletRequest privateRequest() {
        var request = new MockHttpServletRequest();
        request.setAttribute(MaintenanceIngress.PRIVATE_CONNECTOR_ATTRIBUTE, true);
        return request;
    }

    private static void assertDenied(org.junit.jupiter.api.function.Executable operation) {
        assertEquals("MAINTENANCE.DENIED", assertThrows(ApiException.class, operation).getCode());
    }
}
