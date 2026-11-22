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
    private final MaintenancePrincipals principals;
    private final DeploymentCredential deployment;
    private final ObjectMapper json;

    public MaintenanceInternalFilter(MaintenancePrincipals principals, DeploymentCredential deployment, ObjectMapper json) {
        this.principals = principals;
        this.deployment = deployment;
        this.json = json;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request){String path=AccountRequestPath.path(request);return !path.startsWith("/internal/") || path.startsWith("/internal/accounts/");}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws IOException,ServletException {
        response.setHeader("Cache-Control","no-store");
        try {
            String path=AccountRequestPath.path(request),access=ApiAccessCatalog.access(request.getMethod(),path);
            if (!path.startsWith("/internal/maintenance/")) throw MaintenanceJson.denied();
            switch (access) {
                case "DEPLOYMENT" -> deployment.requireWindowOperation(request);
                case "MAINTENANCE" -> principals.require(request, !"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod()));
                default -> throw MaintenanceJson.denied();
            }
            chain.doFilter(request,response);
        } catch(ApiException e){response.setStatus(e.getStatus().value());response.setCharacterEncoding("UTF-8");response.setContentType("application/json");json.writeValue(response.getWriter(),ErrorResponse.of(e.getCode(),e.getMessage(),e.getDetails()));}
    }
}
