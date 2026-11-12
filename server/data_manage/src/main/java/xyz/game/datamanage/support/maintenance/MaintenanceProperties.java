package xyz.game.datamanage.support.maintenance;

import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** 所有密钥只接受私有文件路径；缺失时相关私有能力失败关闭。 */
@Component
@ConfigurationProperties("app.maintenance")
public class MaintenanceProperties {
    private UUID principalId;
    private String displayName = "AI维护";
    private long credentialVersion = 1;
    private Path tokenPath = Path.of("../../config/auth/maintenance-token.txt");
    private Path deploymentTokenPath = Path.of("../../config/auth/deployment-token.txt");
    private Path validationPublicKeyPath = Path.of("../../config/auth/validation-public.der");
    private List<String> allowedOrigins = List.of("https://localhost:5174");
    private List<String> trustedAddresses = List.of("127.0.0.1", "::1");
    public UUID getPrincipalId() { return principalId; }
    public void setPrincipalId(UUID value) { principalId = value; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String value) { displayName = value; }
    public long getCredentialVersion() { return credentialVersion; }
    public void setCredentialVersion(long value) { credentialVersion = value; }
    public Path getTokenPath() { return tokenPath; }
    public void setTokenPath(Path value) { tokenPath = value; }
    public Path getDeploymentTokenPath() { return deploymentTokenPath; }
    public void setDeploymentTokenPath(Path value) { deploymentTokenPath = value; }
    public Path getValidationPublicKeyPath() { return validationPublicKeyPath; }
    public void setValidationPublicKeyPath(Path value) { validationPublicKeyPath = value; }
    public List<String> getAllowedOrigins() { return allowedOrigins; }
    public void setAllowedOrigins(List<String> value) { allowedOrigins = List.copyOf(value); }
    public List<String> getTrustedAddresses() { return trustedAddresses; }
    public void setTrustedAddresses(List<String> value) { trustedAddresses = List.copyOf(value); }
}
