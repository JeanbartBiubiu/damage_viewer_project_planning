package xyz.game.datamanage.support.account;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.support.error.ApiException;

/** 内部业务入口自身必须调用；认证不依赖原始URI是否经过编码、分号或框架规范化。 */
@Component
public class InternalAccountGuard {
    private static final String VERIFIED=InternalAccountGuard.class.getName()+".verified";
    private final AccountProperties properties;
    public InternalAccountGuard(AccountProperties properties) { this.properties=properties; }
    public void require(HttpServletRequest request) {
        if (Boolean.TRUE.equals(request.getAttribute(VERIFIED))) return;
        boolean accepted=false;
        if (trusted(request.getRemoteAddr())) {
            try {
                String expected=Files.readString(properties.getInternalTokenPath(),StandardCharsets.UTF_8).strip();
                String supplied=request.getHeader("X-Damage-Internal-Token");
                accepted=expected.length()>=43 && supplied!=null && supplied.length()<=256 && AccountCrypto.same(expected,supplied)
                    && (request.isSecure() || java.net.InetAddress.getByName(request.getRemoteAddr()).isLoopbackAddress());
            } catch (Exception ignored) { /* 统一失败关闭，不回显凭据、文件内容或存在性。 */ }
        }
        if (!accepted) throw new ApiException(HttpStatus.UNAUTHORIZED,"AUTH.INTERNAL_UNAUTHORIZED","内网调用认证失败");
        if (!"POST".equals(request.getMethod()) || request.getContentType()==null
            || !request.getContentType().split(";",2)[0].trim().equalsIgnoreCase("application/json")) throw AccountErrors.bad();
        request.setAttribute(VERIFIED,Boolean.TRUE);
    }
    private boolean trusted(String address) {
        if (address==null || !address.matches("[0-9a-fA-F:.]+")) return false;
        try {
            byte[] actual=java.net.InetAddress.getByName(address).getAddress();
            for (String allowed:properties.getInternalTrustedAddresses()) {
                if (allowed.matches("[0-9a-fA-F:.]+") && java.util.Arrays.equals(actual,java.net.InetAddress.getByName(allowed).getAddress())) return true;
            }
        } catch (Exception ignored) { /* 无效地址不被信任。 */ }
        return false;
    }
}
