package xyz.game.datamanage.support.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;
import org.springframework.http.server.PathContainer;

/** 单一接口分类清单同时供实际鉴权、路由覆盖检查及代理配置导出消费。 */
public final class ApiAccessCatalog {
    public record Route(String method,String path,String access,PathPattern pattern) {}
    private static final List<Route> ROUTES=load();
    private ApiAccessCatalog() {}
    public static List<Route> routes(){return ROUTES;}
    public static String access(String method,String path) {
        if(path==null || path.contains("//") || path.indexOf(';')>=0 || path.indexOf('%')>=0 || path.indexOf('\\')>=0 || path.contains("..")) return "DENY";
        String effective=method.equals("HEAD")?"GET":method;
        return ROUTES.stream().filter(r->r.method().equals(effective) && r.pattern().matches(PathContainer.parsePath(path))).map(Route::access).findFirst().orElse("DENY");
    }
    private static List<Route> load() {
        try(var input=ApiAccessCatalog.class.getResourceAsStream("/api-access.json")) {
            if(input==null) throw new IllegalStateException("缺少接口分类清单");
            JsonNode root=new ObjectMapper().readTree(input);List<Route> rows=new ArrayList<>();
            if(root.path("version").asInt()!=1 || !root.path("routes").isArray()) throw new IllegalStateException("接口分类清单无效");
            var unique=new java.util.HashSet<String>();
            for(JsonNode row:root.path("routes")) {
                String method=row.path("method").asText(),path=row.path("path").asText(),access=row.path("access").asText();
                if(!java.util.Set.of("GET","POST","PUT","PATCH","DELETE").contains(method) || !java.util.Set.of("PUBLIC_READ","PUBLIC_ACCOUNT","PUBLIC_REPORT","MAINTENANCE","ACCOUNT_INTERNAL","DEPLOYMENT").contains(access) || !unique.add(method+" "+path)) throw new IllegalStateException("接口分类重复或无效");
                rows.add(new Route(method,path,access,PathPatternParser.defaultInstance.parse(path)));
            }
            return List.copyOf(rows);
        } catch(java.io.IOException e){throw new IllegalStateException("接口分类无法加载",e);}
    }
}
