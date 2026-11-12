package xyz.game.datamanage.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.filter.CorsFilter;
import xyz.game.datamanage.support.account.AccountProperties;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import java.util.List;

@Configuration
public class WebCorsConfig {
    @Bean
    public FilterRegistrationBean<CorsFilter> accountCorsFilter(AccountProperties properties,xyz.game.datamanage.support.maintenance.MaintenanceProperties maintenance) {
        CorsFilter filter=new CorsFilter(request -> {
            String path=xyz.game.datamanage.support.account.AccountRequestPath.path(request);
            if (!path.startsWith("/api/") && !path.startsWith("/internal/maintenance/")) return null;
            jakarta.servlet.http.HttpServletRequest effective=request;
            if (org.springframework.web.cors.CorsUtils.isPreFlightRequest(request)) {
                effective=new jakarta.servlet.http.HttpServletRequestWrapper(request) {
                    @Override public String getMethod() { return request.getHeader(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD); }
                };
            }
            boolean publicRead=AdminAuthFilter.publicGameRead(effective);
            CorsConfiguration config=new CorsConfiguration();
            config.setAllowedOrigins(publicRead?List.of("*"):(path.startsWith("/api/auth/") || path.equals("/api/visits")?properties.getAllowedOrigins():maintenance.getAllowedOrigins()));
            config.setAllowedMethods(List.of("GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"));
            config.setAllowedHeaders(List.of("Content-Type","X-Damage-Client","X-CSRF-Token","X-Damage-Maintenance-Batch","If-None-Match"));
            config.setExposedHeaders(List.of(HttpHeaders.ETAG,"Retry-After","X-Damage-Flow-CSRF"));
            config.setAllowCredentials(!publicRead); config.setMaxAge(3600L); return config;
        });
        FilterRegistrationBean<CorsFilter> bean=new FilterRegistrationBean<>(filter);
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE+5); return bean;
    }
}
