package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import xyz.game.datamanage.support.error.ErrorResponse;

/** 使用直连remoteAddr，不信任转发来源头；存在性检查之前完成独立认证。 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class InternalAccountFilter extends OncePerRequestFilter {
    private final InternalAccountGuard guard;
    private final ObjectMapper json;
    public InternalAccountFilter(InternalAccountGuard guard,ObjectMapper json) { this.guard=guard; this.json=json; }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !AccountRequestPath.path(request).startsWith("/internal/accounts/");
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        response.setHeader("Cache-Control","no-store");
        try {
            guard.require(request);
        } catch (xyz.game.datamanage.support.error.ApiException e) {
            response.setStatus(e.getStatus().value());response.setCharacterEncoding("UTF-8");response.setContentType("application/json");
            json.writeValue(response.getWriter(),ErrorResponse.of(e.getCode(),e.getMessage(),e.getDetails()));return;
        }
        chain.doFilter(request,response);
    }
}
