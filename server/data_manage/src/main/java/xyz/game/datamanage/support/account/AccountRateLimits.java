package xyz.game.datamanage.support.account;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class AccountRateLimits {
    private final AccountStore store;
    public AccountRateLimits(AccountStore store) { this.store = store; }
    private record Rule(int seconds, int maximum) {}
    private Rule rule(String scope) { return switch (scope) {
        case "password_account" -> new Rule(900, 5);
        case "password_ip" -> new Rule(600, 30);
        case "register_ip" -> new Rule(3600, 10);
        case "totp_account" -> new Rule(900, 10);
        case "totp_flow" -> new Rule(600, 5);
        default -> throw new IllegalArgumentException("未知限流范围");
    }; }
    public void check(String scope, String subject) {
        rule(scope);
        Long retry = store.jdbc().queryForObject("SELECT COALESCE(MAX(CEIL(EXTRACT(EPOCH FROM (blocked_until-CURRENT_TIMESTAMP)))),0)::bigint FROM auth.rate_limits WHERE scope=? AND subject_hash=? AND blocked_until>CURRENT_TIMESTAMP", Long.class, scope, AccountCrypto.hash(subject));
        if (retry != null && retry > 0) throw limited(retry);
    }
    /** 独立事务使失败计数不随调用方的认证异常回滚。 */
    public void fail(String scope, String subject) {
        Rule rule = rule(scope);
        if (scope.startsWith("totp_")) throw new IllegalArgumentException("动态码必须预占额度");
        store.independent(() -> {
            store.jdbc().update("""
                INSERT INTO auth.rate_limits(scope,subject_hash,window_started_at,attempt_count,blocked_until,expires_at)
                SELECT ?,?,to_timestamp(floor(extract(epoch from CURRENT_TIMESTAMP)/?)*?),1,NULL,
                       to_timestamp((floor(extract(epoch from CURRENT_TIMESTAMP)/?)+1)*?)
                ON CONFLICT(scope,subject_hash,window_started_at) DO UPDATE SET
                    attempt_count=auth.rate_limits.attempt_count+1,
                    blocked_until=CASE WHEN auth.rate_limits.attempt_count+1>=? THEN auth.rate_limits.expires_at ELSE auth.rate_limits.blocked_until END
                """, scope,AccountCrypto.hash(subject),rule.seconds,rule.seconds,rule.seconds,rule.seconds,rule.maximum);
            return null;
        });
    }
    /** 在独立短事务中原子预占真实验证码尝试，超限请求不进入验证码校验。 */
    public void reserveTotp(String scope,String subject) {
        rule(scope);
        if (!scope.equals("totp_flow") && !scope.equals("totp_account")) throw new IllegalArgumentException("只能预占动态码额度");
        Integer reserved=store.independent(()-> {
            java.util.List<Integer> rows;
            if ("totp_flow".equals(scope)) {
                rows=store.jdbc().queryForList("""
                    INSERT INTO auth.rate_limits(scope,subject_hash,window_started_at,attempt_count,blocked_until,expires_at)
                    SELECT 'totp_flow',?,created_at,1,NULL,expires_at FROM auth.flows WHERE id=? AND expires_at>clock_timestamp()
                    ON CONFLICT(scope,subject_hash,window_started_at) DO UPDATE SET
                        attempt_count=auth.rate_limits.attempt_count+1,
                        blocked_until=CASE WHEN auth.rate_limits.attempt_count+1>=5 THEN auth.rate_limits.expires_at ELSE auth.rate_limits.blocked_until END
                    WHERE auth.rate_limits.attempt_count<5
                    RETURNING attempt_count
                    """,Integer.class,AccountCrypto.hash(subject),java.util.UUID.fromString(subject));
            } else {
                rows=store.jdbc().queryForList("""
                    INSERT INTO auth.rate_limits(scope,subject_hash,window_started_at,attempt_count,blocked_until,expires_at)
                    SELECT 'totp_account',?,to_timestamp(floor(extract(epoch from CURRENT_TIMESTAMP)/900)*900),1,NULL,
                        to_timestamp((floor(extract(epoch from CURRENT_TIMESTAMP)/900)+1)*900)
                    ON CONFLICT(scope,subject_hash,window_started_at) DO UPDATE SET
                        attempt_count=auth.rate_limits.attempt_count+1,
                        blocked_until=CASE WHEN auth.rate_limits.attempt_count+1>=10 THEN auth.rate_limits.expires_at ELSE auth.rate_limits.blocked_until END
                    WHERE auth.rate_limits.attempt_count<10
                    RETURNING attempt_count
                    """,Integer.class,AccountCrypto.hash(subject));
            }
            return rows.isEmpty()?0:rows.getFirst();
        });
        if (reserved==null || reserved==0) { check(scope,subject); throw limited("totp_flow".equals(scope)?600:900); }
    }
    /** 注册先原子占用额度，避免并发注册绕过上限。 */
    public void registration(String address) {
        check("register_ip", address);
        fail("register_ip", address);
        check("register_ip", address);
    }
    private ApiException limited(long seconds) { return new ApiException(HttpStatus.TOO_MANY_REQUESTS,"AUTH.RATE_LIMITED","尝试过于频繁，请稍后重试", Map.of("retryAfter", seconds)); }
}
