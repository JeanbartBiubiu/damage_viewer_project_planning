package xyz.game.datamanage.support.maintenance;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.support.account.AccountCrypto;

@Component
public class DeploymentCredential {
    private final MaintenanceProperties properties;
    private final MaintenanceIngress ingress;

    public DeploymentCredential(MaintenanceProperties properties, MaintenanceIngress ingress) {
        this.properties = properties;
        this.ingress = ingress;
    }

    public void requireWindowOperation(HttpServletRequest request) {
        ingress.require(request, true);
        requireToken(request);
    }

    public void requireStatistics(HttpServletRequest request) {
        if (MaintenanceIngress.isPrivate(request)) {
            ingress.require(request, false);
        } else if (!properties.getTrustedAddresses().contains(request.getRemoteAddr())) {
            throw MaintenanceJson.denied();
        }
        requireToken(request);
    }

    private void requireToken(HttpServletRequest request) {
        Path path = properties.getDeploymentTokenPath();
        String supplied = request.getHeader("X-Damage-Deployment-Token");
        if (path == null || supplied == null || supplied.length() < 43 || supplied.length() > 256) {
            throw MaintenanceJson.denied();
        }
        try {
            String expected = Files.readString(path).strip();
            if (!AccountCrypto.same(expected, supplied)) throw MaintenanceJson.denied();
        } catch (IOException e) {
            throw MaintenanceJson.denied();
        }
    }
}
