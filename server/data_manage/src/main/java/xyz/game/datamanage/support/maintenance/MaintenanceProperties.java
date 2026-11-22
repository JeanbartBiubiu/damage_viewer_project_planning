package xyz.game.datamanage.support.maintenance;

import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** 私有入口与维护主体的后端配置。 */
@Component
@ConfigurationProperties("app.maintenance")
public class MaintenanceProperties {
    private UUID principalId;
    private String socketPath;
    private Integer devPort;
    private Path deploymentTokenPath = Path.of("../../config/auth/deployment-token.txt");
    private Path validationPublicKeyPath = Path.of("../../config/auth/validation-public.der");
    private List<String> allowedOrigins = List.of("https://localhost:5174");
    private List<String> trustedAddresses = List.of("127.0.0.1", "::1");
    public UUID getPrincipalId() { return principalId; }
    public void setPrincipalId(UUID value) { principalId = value; }
    public String getSocketPath() { return socketPath; }
    public void setSocketPath(String value) { socketPath = value; }
    public Integer getDevPort() { return devPort; }
    public void setDevPort(Integer value) { devPort = value; }
    public Path getDeploymentTokenPath() { return deploymentTokenPath; }
    public void setDeploymentTokenPath(Path value) { deploymentTokenPath = value; }
    public Path getValidationPublicKeyPath() { return validationPublicKeyPath; }
    public void setValidationPublicKeyPath(Path value) { validationPublicKeyPath = value; }
    public List<String> getAllowedOrigins() { return allowedOrigins; }
    public void setAllowedOrigins(List<String> value) { allowedOrigins = List.copyOf(value); }
    public List<String> getTrustedAddresses() { return trustedAddresses; }
    public void setTrustedAddresses(List<String> value) { trustedAddresses = List.copyOf(value); }
}
