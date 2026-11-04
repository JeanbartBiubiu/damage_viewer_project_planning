package xyz.game.datamanage.support.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.filter.OncePerRequestFilter;
import xyz.game.datamanage.support.account.AccountBrowser;
import xyz.game.datamanage.support.account.AccountSessions;
import xyz.game.datamanage.support.account.AccountRequestPath;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.ErrorResponse;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class AdminAuthFilter extends OncePerRequestFilter {
    public static final String AUTH_CONTEXT_ATTR="authContext";
    public static final String RESOLVED_CONTEXT_ATTR=AdminAuthFilter.class.getName()+".resolved";
    private final ObjectMapper json;
    private final AccountSessions sessions;
    private final AccountBrowser browser;
    public AdminAuthFilter(ObjectMapper json,AccountSessions sessions,AccountBrowser browser) { this.json=json; this.sessions=sessions; this.browser=browser; }
    /** 仅明确的游戏数据读取公开；账号GET和其他管理命名空间不据HTTP方法放行。 */
    public static boolean publicGameRead(HttpServletRequest request) {
        String path=AccountRequestPath.path(request);
        boolean games=path.equals("/api/games") || path.matches("/api/games/[^/]+/images")
            || path.equals("/api/admin/games") || path.startsWith("/api/admin/games/");
        if (games && ("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))) return true;
        return "POST".equals(request.getMethod()) && path.matches("/api/admin/games/[^/]+/simulation-snapshot");
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !AccountRequestPath.path(request).startsWith("/api/") || CorsUtils.isPreFlightRequest(request) || publicGameRead(request);
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        String path=AccountRequestPath.path(request);
        if (path.startsWith("/api/auth/")) response.setHeader("Cache-Control","no-store");
        try {
            boolean mutation=!Set.of("GET","HEAD","OPTIONS").contains(request.getMethod());
            if (mutation) browser.mutation(request);
            if (path.startsWith("/api/auth/") && mutation) request=bounded(request);
            // 初始化不读取残留Cookie或CSRF；流程在服务内核验专属凭证。
            if (path.startsWith("/api/auth/") && (Set.of("/api/auth/register","/api/auth/login","/api/auth/recovery/password","/api/auth/recovery/totp","/api/auth/login/totp","/api/auth/logout").contains(path) || path.startsWith("/api/auth/flow/"))) {
                chain.doFilter(request,response); return;
            }
            if (path.startsWith("/api/auth/") || path.startsWith("/api/admin/")) {
                AccountSessions.Resolved resolved=sessions.resolve(AccountBrowser.cookie(request,AccountBrowser.SESSION));
                if (path.startsWith("/api/admin/") && !resolved.context().canEdit()) throw new ApiException(HttpStatus.FORBIDDEN,"AUTH.EDIT_REQUIRED","需要编辑权限");
                if (mutation) browser.csrf(request,false,resolved.csrfHash());
                request.setAttribute(AUTH_CONTEXT_ATTR,resolved.context());
                request.setAttribute(RESOLVED_CONTEXT_ATTR,resolved);
            }
            chain.doFilter(request,response);
        } catch (ApiException e) {
            response.setStatus(e.getStatus().value());
            response.setCharacterEncoding(StandardCharsets.UTF_8.name()); response.setContentType("application/json");
            if (e.getStatus()==HttpStatus.TOO_MANY_REQUESTS) response.setHeader("Retry-After",String.valueOf(e.getDetails().getOrDefault("retryAfter",60)));
            json.writeValue(response.getWriter(),ErrorResponse.of(e.getCode(),e.getMessage(),e.getDetails()));
        }
    }
    private HttpServletRequest bounded(HttpServletRequest request) throws IOException {
        byte[] bytes=request.getInputStream().readNBytes(8193);
        if (bytes.length>8192) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE,"AUTH.REQUEST_TOO_LARGE","账号请求过大");
        return new HttpServletRequestWrapper(request) {
            @Override public ServletInputStream getInputStream() {
                ByteArrayInputStream input=new ByteArrayInputStream(bytes);
                return new ServletInputStream() {
                    public int read() { return input.read(); }
                    public boolean isFinished() { return input.available()==0; }
                    public boolean isReady() { return true; }
                    public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
                };
            }
            @Override public java.io.BufferedReader getReader() { return new java.io.BufferedReader(new java.io.InputStreamReader(getInputStream(),StandardCharsets.UTF_8)); }
        };
    }
}
