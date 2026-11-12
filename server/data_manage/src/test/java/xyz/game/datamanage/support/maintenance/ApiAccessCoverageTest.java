package xyz.game.datamanage.support.maintenance;

import java.lang.reflect.Method;
import java.util.HashSet;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import xyz.game.datamanage.support.auth.ApiAccessCatalog;
import static org.junit.jupiter.api.Assertions.*;

class ApiAccessCoverageTest {
    static class Introspection extends RequestMappingHandlerMapping {
        RequestMappingInfo mapping(Method method,Class<?> type){return getMappingForMethod(method,type);}
    }
    @Test void everyRealBusinessControllerMappingHasExactlyOneClassification() throws Exception {
        var scanner=new ClassPathScanningCandidateComponentProvider(false);scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        var actual=new HashSet<String>();var mapping=new Introspection();mapping.setPatternParser(org.springframework.web.util.pattern.PathPatternParser.defaultInstance);
        for(var bean:scanner.findCandidateComponents("xyz.game.datamanage")) {
            if(bean.getBeanClassName().contains("Test") || bean.getBeanClassName().contains("Fixture")) continue;
            Class<?> type=Class.forName(bean.getBeanClassName());
            for(Method method:type.getDeclaredMethods()) {
                RequestMappingInfo route=mapping.mapping(method,type);if(route==null) continue;
                for(String path:route.getPatternValues()) if(path.startsWith("/api/") || path.startsWith("/internal/")) route.getMethodsCondition().getMethods().forEach(http->actual.add(http.name()+" "+path));
            }
        }
        var declared=new HashSet<String>();ApiAccessCatalog.routes().forEach(r->assertTrue(declared.add(r.method()+" "+r.path())));
        assertEquals(actual,declared);
    }
    @Test void unknownMethodsAndPrivateRoutesNeverBecomePublicReads() {
        assertEquals("PUBLIC_READ",ApiAccessCatalog.access("HEAD","/api/admin/games/lol/skills/q/configuration"));
        assertEquals("PUBLIC_READ",ApiAccessCatalog.access("POST","/api/admin/games/lol/simulation-snapshot"));
        assertEquals("MAINTENANCE",ApiAccessCatalog.access("PATCH","/api/admin/games/lol/skills/q/configuration"));
        assertEquals("DEPLOYMENT",ApiAccessCatalog.access("GET","/api/admin/visits/last30days"));
        assertEquals("DENY",ApiAccessCatalog.access("GET","/api/admin/personnel"));
        assertEquals("DENY",ApiAccessCatalog.access("GET","/api/admin/games/lol/skills/q/configuration;edit"));
        assertEquals("DENY",ApiAccessCatalog.access("POST","/api/admin/games/lol/new-controller"));
    }
}
