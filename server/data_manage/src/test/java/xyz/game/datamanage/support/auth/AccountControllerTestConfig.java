package xyz.game.datamanage.support.auth;

import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.UUID;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import xyz.game.datamanage.support.account.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** 控制器切片使用明确的模拟会话；生产过滤器仍执行来源、防伪与权限检查。 */
@TestConfiguration
public class AccountControllerTestConfig {
    public static AuthContext editor() { return new AuthContext(UUID.fromString("00000000-0000-4000-8000-000000000001"),"fixture_author",true,
        UUID.fromString("00000000-0000-4000-8000-000000000002"),1,Instant.parse("2099-01-01T00:00:00Z")); }
    @Bean AccountProperties accountProperties() { return new AccountProperties(); }
    @Bean AccountBrowser accountBrowser(AccountProperties properties) { return new AccountBrowser(properties); }
    @Bean InternalAccountGuard internalAccountGuard(AccountProperties properties) { return new InternalAccountGuard(properties); }
    @Bean xyz.game.datamanage.support.maintenance.MaintenanceProperties maintenanceProperties() {
        var properties=new xyz.game.datamanage.support.maintenance.MaintenanceProperties();properties.setAllowedOrigins(java.util.List.of("https://localhost:5173"));return properties;
    }
    @Bean xyz.game.datamanage.support.maintenance.MaintenanceSessions maintenanceSessions() {
        var mock=mock(xyz.game.datamanage.support.maintenance.MaintenanceSessions.class);
        when(mock.require(any(),anyBoolean())).thenReturn(new xyz.game.datamanage.support.maintenance.MaintenanceSessions.Resolved(editor(),AccountCrypto.hash("c".repeat(43))));
        return mock;
    }
    @Bean org.springframework.jdbc.core.JdbcTemplate maintenanceJdbc() {
        var mock=mock(org.springframework.jdbc.core.JdbcTemplate.class);when(mock.queryForObject(anyString(),eq(Boolean.class))).thenReturn(false);return mock;
    }
    @Bean AccountSessions accountSessions() {
        AccountSessions mock=mock(AccountSessions.class);
        when(mock.resolve(anyString())).thenReturn(new AccountSessions.Resolved(editor(),AccountCrypto.hash("c".repeat(43))));
        return mock;
    }
    @Bean MockMvcBuilderCustomizer accountTestRequest() {
        return builder->builder.defaultRequest(get("/").cookie(new Cookie(AccountBrowser.SESSION,"s".repeat(43)),new Cookie(AccountBrowser.CSRF,"c".repeat(43)),new Cookie(xyz.game.datamanage.support.maintenance.MaintenanceSessions.SESSION,"s".repeat(43)),new Cookie(xyz.game.datamanage.support.maintenance.MaintenanceSessions.CSRF,"c".repeat(43)))
            .header("Origin","https://localhost:5173").header("X-Damage-Client","web").header("X-CSRF-Token","c".repeat(43)).contentType("application/json"));
    }
}
