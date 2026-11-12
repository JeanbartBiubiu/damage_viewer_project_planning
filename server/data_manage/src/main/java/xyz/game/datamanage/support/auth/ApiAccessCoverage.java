package xyz.game.datamanage.support.auth;

import java.util.HashSet;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

@Component
public class ApiAccessCoverage implements ApplicationRunner {
    private final RequestMappingHandlerMapping mapping;
    public ApiAccessCoverage(RequestMappingHandlerMapping mapping){this.mapping=mapping;}
    @Override public void run(ApplicationArguments args){verify(mapping);}
    public static void verify(RequestMappingHandlerMapping mapping) {
        var actual=new HashSet<String>();
        mapping.getHandlerMethods().forEach((route,handler)-> {
            if(!handler.getBeanType().getPackageName().startsWith("xyz.game.datamanage")) return;
            for(String path:route.getPatternValues()) {
                if(!path.startsWith("/api/") && !path.startsWith("/internal/")) continue;
                if(route.getMethodsCondition().getMethods().isEmpty()) throw new IllegalStateException("业务接口必须显式声明方法");
                route.getMethodsCondition().getMethods().forEach(method->actual.add(method.name()+" "+path));
            }
        });
        var declared=new HashSet<String>();ApiAccessCatalog.routes().forEach(r->declared.add(r.method()+" "+r.path()));
        if(!actual.equals(declared)) {
            var missing=new HashSet<>(actual);missing.removeAll(declared);var stale=new HashSet<>(declared);stale.removeAll(actual);
            throw new IllegalStateException("接口分类不完整：未分类="+missing+"，已失效="+stale);
        }
    }
}
