package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import xyz.game.datamanage.support.account.AccountBrowser;
import xyz.game.datamanage.support.account.AccountRequestPath;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.error.ErrorResponse;

/** 后端重启不会解除数据库中的维护窗口；私有维护会话仍可核对现场。 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE+19)
public class MaintenanceReadWindowFilter extends OncePerRequestFilter {
    private final JdbcTemplate jdbc;private final MaintenanceSessions sessions;private final ObjectMapper json;
    public MaintenanceReadWindowFilter(JdbcTemplate jdbc,MaintenanceSessions sessions,ObjectMapper json){this.jdbc=jdbc;this.sessions=sessions;this.json=json;}
    @Override protected boolean shouldNotFilter(HttpServletRequest request){return !AdminAuthFilter.publicGameRead(request) && !AccountRequestPath.path(request).equals("/api/auth/wasm-grant");}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws IOException,ServletException {
        boolean maintained=Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM auth.maintenance_batches WHERE state='OPEN')",Boolean.class));
        if(maintained) {
            try {if(AccountBrowser.cookie(request,MaintenanceSessions.SESSION)!=null){sessions.resolve(request);chain.doFilter(request,response);return;}}
            catch(xyz.game.datamanage.support.error.ApiException e){ /* 无效维护凭据不能绕过窗口。 */ }
            response.setStatus(503);response.setHeader("Cache-Control","no-store");response.setHeader("Retry-After","30");response.setCharacterEncoding("UTF-8");response.setContentType("application/json");
            json.writeValue(response.getWriter(),ErrorResponse.of("MAINTENANCE.WINDOW_OPEN","配置维护中，请稍后重试",java.util.Map.of()));return;
        }
        chain.doFilter(request,response);
    }
}
