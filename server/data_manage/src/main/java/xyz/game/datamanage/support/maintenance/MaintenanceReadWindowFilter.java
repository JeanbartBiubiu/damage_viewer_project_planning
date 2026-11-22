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
import xyz.game.datamanage.support.account.AccountRequestPath;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.ErrorResponse;

/** 后端重启不会解除数据库中的维护窗口；通过私有入口的同源读取可核对现场。 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE+19)
public class MaintenanceReadWindowFilter extends OncePerRequestFilter {
    private final JdbcTemplate jdbc;
    private final MaintenancePrincipals principals;
    private final ObjectMapper json;

    public MaintenanceReadWindowFilter(JdbcTemplate jdbc, MaintenancePrincipals principals, ObjectMapper json) {
        this.jdbc = jdbc;
        this.principals = principals;
        this.json = json;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request){return !AdminAuthFilter.publicGameRead(request) && !AccountRequestPath.path(request).equals("/api/auth/wasm-grant");}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws IOException,ServletException {
        if (MaintenanceIngress.isPrivate(request) && AdminAuthFilter.publicGameRead(request)) {
            response.setHeader("Cache-Control", "no-store");
            try {
                principals.require(request, false);
            } catch (ApiException e) {
                writeError(response, e.getStatus().value(), e.getCode(), e.getMessage());
                return;
            }
        } else if (Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM auth.maintenance_batches WHERE state='OPEN')", Boolean.class))) {
            response.setHeader("Retry-After", "30");
            writeError(response, 503, "MAINTENANCE.WINDOW_OPEN", "配置维护中，请稍后重试");
            return;
        }
        chain.doFilter(request, response);
    }

    private void writeError(HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setHeader("Cache-Control", "no-store");
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/json");
        json.writeValue(response.getWriter(), ErrorResponse.of(code, message, java.util.Map.of()));
    }
}
