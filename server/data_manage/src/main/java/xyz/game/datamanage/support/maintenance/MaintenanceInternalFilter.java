package xyz.game.datamanage.support.maintenance;

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
import xyz.game.datamanage.support.account.AccountRequestPath;
import xyz.game.datamanage.support.auth.ApiAccessCatalog;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.ErrorResponse;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE+11)
public class MaintenanceInternalFilter extends OncePerRequestFilter {
    private final MaintenanceSessions sessions;private final ObjectMapper json;
    public MaintenanceInternalFilter(MaintenanceSessions sessions,ObjectMapper json){this.sessions=sessions;this.json=json;}
    @Override protected boolean shouldNotFilter(HttpServletRequest request){String path=AccountRequestPath.path(request);return !path.startsWith("/internal/") || path.startsWith("/internal/accounts/");}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws IOException,ServletException {
        response.setHeader("Cache-Control","no-store");
        try {
            String path=AccountRequestPath.path(request),access=ApiAccessCatalog.access(request.getMethod(),path);
            if(!sessions.trusted(request) || !path.startsWith("/internal/maintenance/") || access.equals("DENY")) throw MaintenanceJson.denied();
            if(access.equals("DEPLOYMENT")) sessions.credential(request,true);
            else if(path.equals("/internal/maintenance/sessions") || path.equals("/internal/maintenance/revoke")) sessions.credential(request,false);
            else sessions.require(request,!java.util.Set.of("GET","HEAD","OPTIONS").contains(request.getMethod()));
            chain.doFilter(request,response);
        } catch(ApiException e){response.setStatus(e.getStatus().value());response.setCharacterEncoding("UTF-8");response.setContentType("application/json");json.writeValue(response.getWriter(),ErrorResponse.of(e.getCode(),e.getMessage(),e.getDetails()));}
    }
}
