package xyz.game.datamanage.support.account;

import java.nio.file.Path;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** 私密配置只存文件路径；缺少密钥时拒绝相关操作，绝不自动生成临时密钥。 */
@Component
@ConfigurationProperties("app.auth")
public class AccountProperties {
    private List<String> allowedOrigins = List.of("https://localhost:5173");
    private Path aeadKeysetPath = Path.of("../../config/auth/aead-keyset.json");
    private String aeadKeyId = "auth-aead-1";
    private Path grantPrivateKeyPath = Path.of("../../config/auth/grant-private.pk8");
    private String grantKeyId = "wasm-1";
    private Path internalTokenPath = Path.of("../../config/auth/internal-token.txt");
    private List<String> internalTrustedAddresses = List.of("127.0.0.1", "::1");
    private boolean cleanupEnabled = true;
    public List<String> getAllowedOrigins() { return allowedOrigins; }
    public void setAllowedOrigins(List<String> v) { allowedOrigins = List.copyOf(v); }
    public Path getAeadKeysetPath() { return aeadKeysetPath; }
    public void setAeadKeysetPath(Path v) { aeadKeysetPath = v; }
    public String getAeadKeyId() { return aeadKeyId; }
    public void setAeadKeyId(String v) { aeadKeyId = v; }
    public Path getGrantPrivateKeyPath() { return grantPrivateKeyPath; }
    public void setGrantPrivateKeyPath(Path v) { grantPrivateKeyPath = v; }
    public String getGrantKeyId() { return grantKeyId; }
    public void setGrantKeyId(String v) { grantKeyId = v; }
    public Path getInternalTokenPath() { return internalTokenPath; }
    public void setInternalTokenPath(Path v) { internalTokenPath = v; }
    public List<String> getInternalTrustedAddresses() { return internalTrustedAddresses; }
    public void setInternalTrustedAddresses(List<String> v) { internalTrustedAddresses = List.copyOf(v); }
    public boolean isCleanupEnabled() { return cleanupEnabled; }
    public void setCleanupEnabled(boolean v) { cleanupEnabled = v; }
}
