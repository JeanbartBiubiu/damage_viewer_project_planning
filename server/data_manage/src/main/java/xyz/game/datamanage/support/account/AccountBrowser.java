package xyz.game.datamanage.support.account;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

@Component
public class AccountBrowser {
    public static final String SESSION = "__Host-dv_session", CSRF = "__Host-dv_csrf",
        FLOW = "__Host-dv_flow", FLOW_CSRF = "__Host-dv_flow_csrf";
    public static final String FLOW_CSRF_HEADER="X-Damage-Flow-CSRF";
    public static final String FLOW_CSRF_RESPONSE_ATTR=AccountBrowser.class.getName()+".flowCsrf";
    private final AccountProperties properties;
    public AccountBrowser(AccountProperties properties) { this.properties = properties; }
    public void mutation(HttpServletRequest request) {
        String type = request.getContentType();
        String origin=request.getHeader("Origin");
        if (origin==null || !properties.getAllowedOrigins().contains(origin)
            || !"web".equals(request.getHeader("X-Damage-Client"))
            || type == null || !type.split(";", 2)[0].trim().equalsIgnoreCase("application/json")) throw denied();
    }
    public static String cookie(HttpServletRequest request, String name) {
        String found = null;
        if (request.getCookies() != null) for (Cookie cookie : request.getCookies()) if (name.equals(cookie.getName())) {
            if (found != null) throw AccountErrors.invalid();
            found = cookie.getValue();
        }
        if (found != null && !found.matches("[A-Za-z0-9_-]{43}")) throw AccountErrors.invalid();
        return found;
    }
    public void csrf(HttpServletRequest request, boolean flow, byte[] expectedHash) {
        String cookie = cookie(request, flow ? FLOW_CSRF : CSRF);
        String header = request.getHeader("X-CSRF-Token");
        if (cookie == null || !AccountCrypto.same(cookie,header) || expectedHash == null
            || !MessageDigest.isEqual(AccountCrypto.hash(cookie), expectedHash)) throw denied();
    }
    public void issue(HttpServletResponse response, boolean flow, String token, String csrf, Instant now, Instant expiry) {
        Duration duration = Duration.between(now, expiry);
        add(response, flow ? FLOW : SESSION, token, true, duration);
        add(response, flow ? FLOW_CSRF : CSRF, csrf, false, duration);
    }
    public void clear(HttpServletResponse response, boolean flow) {
        add(response, flow ? FLOW : SESSION, "", true, Duration.ZERO);
        add(response, flow ? FLOW_CSRF : CSRF, "", false, Duration.ZERO);
    }
    private void add(HttpServletResponse response, String name, String value, boolean httpOnly, Duration lifetime) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(name, value).secure(true).httpOnly(httpOnly)
            .sameSite("Strict").path("/").maxAge(lifetime).build().toString());
    }
    private xyz.game.datamanage.support.error.ApiException denied() {
        return new xyz.game.datamanage.support.error.ApiException(org.springframework.http.HttpStatus.FORBIDDEN,"AUTH.CSRF_REJECTED","请求来源或防伪校验失败");
    }
}
