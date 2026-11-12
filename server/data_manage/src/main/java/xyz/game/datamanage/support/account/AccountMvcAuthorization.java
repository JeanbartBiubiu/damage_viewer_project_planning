package xyz.game.datamanage.support.account;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import xyz.game.datamanage.controller.adminapi.simulation.SimulationSnapshotAdminController;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.error.ApiException;

/** 在真实路由匹配后守住游戏写入口；即使容器路径规范化方式改变，也不能跳过鉴权。 */
@Configuration
public class AccountMvcAuthorization implements WebMvcConfigurer {
    private final xyz.game.datamanage.support.maintenance.MaintenanceSessions sessions;
    public AccountMvcAuthorization(xyz.game.datamanage.support.maintenance.MaintenanceSessions sessions) { this.sessions=sessions; }
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler) {
                if (!(handler instanceof HandlerMethod method) || !method.getBeanType().getPackageName().startsWith("xyz.game.datamanage.controller.adminapi")) return true;
                if (request.getMethod().equals("GET") || request.getMethod().equals("HEAD")) return true;
                if (request.getMethod().equals("POST") && SimulationSnapshotAdminController.class.isAssignableFrom(method.getBeanType())) return true;
                var resolved=sessions.require(request,true);
                request.setAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR,resolved.context());
                return true;
            }
        });
    }
}
