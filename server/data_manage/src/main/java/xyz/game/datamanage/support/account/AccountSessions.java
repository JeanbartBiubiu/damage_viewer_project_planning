package xyz.game.datamanage.support.account;

import jakarta.servlet.http.HttpServletRequest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class AccountSessions {
    public record Resolved(AuthContext context, byte[] csrfHash) {}
    private final AccountStore store;
    public AccountSessions(AccountStore store) { this.store = store; }
    public Resolved resolve(String token) {
        if (token == null) throw AccountErrors.invalid();
        Resolved result = store.first("""
            SELECT s.id AS session_id,s.account_id,s.auth_epoch,s.csrf_hash,s.expires_at,
                a.username,a.can_login,a.status
            FROM auth.sessions s JOIN auth.accounts a ON a.id=s.account_id
            JOIN auth.totp_credentials t ON t.account_id=a.id
            WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND s.auth_epoch=a.auth_epoch
            """, (r,n) -> {
                String status=r.getString("status");
                if ("disabled".equals(status)) throw new ApiException(HttpStatus.FORBIDDEN,"AUTH.ACCOUNT_DISABLED","账号已禁用");
                if (r.getInt("can_login")!=1) throw new ApiException(HttpStatus.FORBIDDEN,"AUTH.LOGIN_NOT_ENABLED","账号尚未开通");
                if (!"active".equals(status)) throw AccountErrors.invalid();
                return new Resolved(new AuthContext(r.getObject("account_id",UUID.class),r.getString("username"),false,
                    r.getObject("session_id",UUID.class),r.getLong("auth_epoch"),r.getTimestamp("expires_at").toInstant()),r.getBytes("csrf_hash"));
            }, AccountCrypto.hash(token));
        if (result==null) throw AccountErrors.invalid();
        return result;
    }
    public static Map<String,Object> view(AuthContext auth) {
        return Map.of("accountId",auth.accountId(),"username",auth.username(),"canLogin",1,"expiresAt",auth.expiresAt());
    }
}
