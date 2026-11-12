package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import xyz.game.datamanage.DataManageApplication;
import static org.junit.jupiter.api.Assertions.*;

/** 显式启动：只在测试实例新建随机临时库，真实服务、HTTP、事务与独立回读。默认单测不发现 IT。 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class MaintenanceDatabaseIT {
    private final ObjectMapper json=new ObjectMapper();
    private final UUID principal=UUID.randomUUID();
    private final Map<String,String> cookies=new HashMap<>();
    private Path root,temporary;
    private ConfigurableApplicationContext context;
    private Connection admin;
    private JdbcTemplate jdbc;
    private String database,base,maintenanceToken,deploymentToken;
    private KeyPair signing;
    private boolean databaseCreated;
    @BeforeAll void setup() throws Exception {
        System.setProperty("sun.net.http.allowRestrictedHeaders","true");
        if(!"isolated-maintenance-tests".equals(System.getenv("DAMAGE_MAINTENANCE_IT_ALLOW_MUTATION"))) throw new IllegalStateException("必须显式授权隔离维护测试");
        root=Path.of("../..").toAbsolutePath().normalize();
        Path config=Path.of(required("DAMAGE_MAINTENANCE_IT_CONFIG"));JsonNode secret=json.readTree(Files.readAllBytes(config));
        if(!"test0221".equals(secret.path("expectedDatabase").asText())) throw new IllegalStateException("只允许已确认测试实例");
        String url=secret.path("jdbcUrl").asText(),username=secret.path("username").asText(),password=secret.path("password").asText();
        if(!url.matches("jdbc:postgresql://[^/]+/test0221(?:\\?.*)?")) throw new IllegalStateException("测试实例连接目标不匹配");
        database="dv_maint_verify_20261113_"+UUID.randomUUID().toString().replace("-","").substring(0,8);
        try {
            admin=DriverManager.getConnection(url,username,password);
            try(var query=admin.createStatement().executeQuery("SELECT current_database()")){assertTrue(query.next());assertEquals("test0221",query.getString(1));}
            admin.createStatement().execute("CREATE DATABASE "+database);databaseCreated=true;
            String isolated=url.replaceFirst("/test0221(?=\\?|$)","/"+database);
            jdbc=new JdbcTemplate(new DriverManagerDataSource(isolated,username,password));
            for(String file:java.util.List.of("db/game_manage/schema.sql","db/game_manage/triggers.sql","db/user_manage/schema.sql","db/visit_statistics/schema.sql"))
                jdbc.execute(Files.readString(root.resolve(file)));
            jdbc.update("INSERT INTO public.games(game_id,game_name) VALUES ('lol','隔离验证')");
            jdbc.update("INSERT INTO public.skills(game_id,skill_key,name,max_level,status,sort_order) VALUES ('lol','q','原技能',1,'ENABLED',0)");
            temporary=Files.createTempDirectory("damage-maintenance-it-");
            maintenanceToken=random();deploymentToken=random();Files.writeString(temporary.resolve("maintenance.txt"),maintenanceToken);Files.writeString(temporary.resolve("deployment.txt"),deploymentToken);
            signing=KeyPairGenerator.getInstance("Ed25519").generateKeyPair();Files.write(temporary.resolve("validation-public.der"),signing.getPublic().getEncoded());
            var grant=KeyPairGenerator.getInstance("Ed25519").generateKeyPair();Files.write(temporary.resolve("grant.pk8"),grant.getPrivate().getEncoded());
            Map<String,Object> settings=new HashMap<>();settings.put("server.port",0);settings.put("server.address","127.0.0.1");
            settings.put("spring.datasource.url",isolated);settings.put("spring.datasource.username",username);settings.put("spring.datasource.password",password);
            settings.put("app.auth.cleanup-enabled",false);settings.put("app.auth.grant-private-key-path",temporary.resolve("grant.pk8").toString());
            settings.put("app.maintenance.principal-id",principal.toString());settings.put("app.maintenance.token-path",temporary.resolve("maintenance.txt").toString());
            settings.put("app.maintenance.deployment-token-path",temporary.resolve("deployment.txt").toString());settings.put("app.maintenance.validation-public-key-path",temporary.resolve("validation-public.der").toString());
            settings.put("logging.level.root","ERROR");settings.put("spring.main.banner-mode","off");
            context=new SpringApplicationBuilder(DataManageApplication.class).web(WebApplicationType.SERVLET)
                .initializers(ctx->ctx.getEnvironment().getPropertySources().addFirst(new MapPropertySource("isolated-maintenance",settings))).run();
            base="http://127.0.0.1:"+((ServletWebServerApplicationContext)context).getWebServer().getPort();
        } catch(Exception e) {cleanup();throw new IllegalStateException("隔离维护测试初始化失败："+e.getClass().getSimpleName());}
    }
    @AfterAll void cleanup() throws Exception {
        if(context!=null){context.close();context=null;}
        if(admin!=null){
            if(databaseCreated && database.matches("dv_maint_verify_20261113_[a-f0-9]{8}")) {
                try(var statement=admin.createStatement()){statement.execute("DROP DATABASE "+database+" WITH (FORCE)");}databaseCreated=false;
            }
            admin.close();admin=null;
        }
        if(temporary!=null){for(Path file:Files.list(temporary).toList())Files.delete(file);Files.delete(temporary);temporary=null;}
    }
    @Test @Order(1) void migrationRemovesPlayerEditFieldButRetainsAccountSessionAndHistoricalLog() throws Exception {
        UUID account=UUID.randomUUID(),session=UUID.randomUUID();
        jdbc.execute("ALTER TABLE \"user\".edit_log DROP COLUMN maintenance_principal_id; DROP TABLE auth.maintenance_commits; DROP TABLE auth.maintenance_batches; DROP TABLE auth.maintenance_sessions; DROP TABLE auth.maintenance_principals; ALTER TABLE auth.accounts ADD COLUMN can_edit boolean NOT NULL DEFAULT false");
        jdbc.update("INSERT INTO auth.accounts(id,username,password_hash,status,can_login,can_edit) VALUES (?,'migration_fixture','fixture','pending',0,true)",account);
        jdbc.update("INSERT INTO auth.sessions(id,account_id,token_hash,csrf_hash,auth_epoch,expires_at) VALUES (?,?,decode(repeat('ab',32),'hex'),decode(repeat('cd',32),'hex'),1,CURRENT_TIMESTAMP+INTERVAL '30 days')",session,account);
        jdbc.update("INSERT INTO \"user\".edit_log(account_id,username_snapshot,edit_body) VALUES (?,'migration_fixture','{}')",account);
        jdbc.execute(Files.readString(root.resolve("db/user_manage/migrations/20261113_viewer_maintenance_identity.sql")));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema='auth' AND table_name='accounts' AND column_name='can_edit'",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.accounts WHERE id=? AND username='migration_fixture'",Integer.class,account));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.sessions WHERE id=? AND revoked_at IS NULL",Integer.class,session));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM \"user\".edit_log WHERE account_id=? AND maintenance_principal_id IS NULL",Integer.class,account));
    }
    @Test @Order(2) void realHttpRequiresSignedBatchAndCommitsDataAuditAndProgressTogether() throws Exception {
        var properties=context.getBean(MaintenanceProperties.class);
        for(int length:new int[]{33,128}) {
            properties.setDisplayName("a".repeat(length));
            assertEquals(403,send("POST","/internal/maintenance/sessions","{}",Map.of("X-Damage-Maintenance-Token",maintenanceToken),false).statusCode());
        }
        properties.setDisplayName("a".repeat(32));
        assertEquals(200,send("GET","/api/games",null,null,false).statusCode());
        String path="/api/admin/games/lol/skills/q",body="{\"name\":\"已验证技能\",\"description\":null,\"maxLevel\":1,\"status\":\"ENABLED\",\"sortOrder\":0,\"skillCategoryKeys\":[]}";
        assertEquals(401,send("PUT",path,body,null,false).statusCode());
        var established=send("POST","/internal/maintenance/sessions","{}",Map.of("X-Damage-Maintenance-Token",maintenanceToken),false);assertEquals(200,established.statusCode());
        for(String cookie:established.headers().allValues("Set-Cookie")){String[] pair=cookie.split(";",2)[0].split("=",2);cookies.put(pair[0],pair[1]);}
        var grant=send("POST","/internal/maintenance/wasm-grant","{}",null,true);assertEquals(200,grant.statusCode());
        assertEquals(403,send("GET","/api/admin/visits/last30days",null,null,true).statusCode());
        assertEquals(401,send("POST","/internal/accounts/"+UUID.randomUUID()+"/enable-login","{\"enablementReference\":\"fixture\"}",Map.of("X-Damage-Maintenance-Token",maintenanceToken),false).statusCode());
        JsonNode claims=json.readTree(Base64.getUrlDecoder().decode(json.readTree(grant.body()).path("grant").asText().split("\\.")[1]));
        assertEquals("MAINTENANCE",claims.path("subjectType").asText());assertFalse(claims.has("canLogin"));assertEquals(2,claims.path("authorizationVersion").asInt());assertTrue(claims.path("exp").asLong()-claims.path("iat").asLong()<=1800);
        assertEquals(403,send("PUT",path,body,null,true).statusCode());
        String digest=json.readTree(send("GET","/internal/maintenance/games/lol/baseline",null,null,true).body()).path("baselineDigest").asText();
        UUID batch=UUID.randomUUID();ObjectNode request=batch(batch,digest,path,body);
        assertEquals(200,send("POST","/internal/maintenance/batches",request.toString(),null,true).statusCode());
        assertEquals(403,send("POST","/internal/maintenance/batches/"+batch+"/open","{}",null,true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+batch+"/open","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),false).statusCode());
        assertEquals(503,send("GET","/api/games",null,null,false).statusCode());
        assertEquals(409,send("PUT",path,body+" ",Map.of("X-Damage-Maintenance-Batch",batch.toString()),true).statusCode());
        assertEquals("原技能",jdbc.queryForObject("SELECT name FROM public.skills WHERE game_id='lol' AND skill_key='q'",String.class));
        assertEquals(200,send("PUT",path,body,Map.of("X-Damage-Maintenance-Batch",batch.toString()),true).statusCode());
        assertEquals("已验证技能",jdbc.queryForObject("SELECT name FROM public.skills WHERE game_id='lol' AND skill_key='q'",String.class));
        assertEquals(1,jdbc.queryForObject("SELECT next_operation FROM auth.maintenance_batches WHERE id=?",Integer.class,batch));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.maintenance_commits WHERE batch_id=? AND principal_id=?",Integer.class,batch,principal));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM \"user\".edit_log WHERE maintenance_principal_id=?",Integer.class,principal));
        assertEquals(409,send("PUT",path,body,Map.of("X-Damage-Maintenance-Batch",batch.toString()),true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+batch+"/complete","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),false).statusCode());
        assertEquals(200,send("GET","/api/games",null,null,false).statusCode());
    }
    @Test @Order(4) void writeWaitingBehindRevocationCannotReuseTheOldMaintenanceVersion() throws Exception {
        var store=context.getBean(xyz.game.datamanage.support.account.AccountStore.class);
        var sessions=context.getBean(MaintenanceSessions.class);
        var lockedJdbc=store.jdbc();
        var request=new org.springframework.mock.web.MockHttpServletRequest();request.setRemoteAddr("127.0.0.1");request.setCookies(new jakarta.servlet.http.Cookie(MaintenanceSessions.SESSION,cookies.get(MaintenanceSessions.SESSION)));
        var auth=sessions.resolve(request).context();
        var executor=java.util.concurrent.Executors.newSingleThreadExecutor();var started=new java.util.concurrent.CountDownLatch(1);var waitingPid=new java.util.concurrent.atomic.AtomicInteger();
        try {
            var pending=store.tx(()-> {
                lockedJdbc.queryForObject("SELECT id FROM auth.maintenance_principals WHERE id=? FOR UPDATE",UUID.class,principal);
                var future=executor.submit(()->store.tx(()-> {waitingPid.set(lockedJdbc.queryForObject("SELECT pg_backend_pid()",Integer.class));started.countDown();sessions.lock(auth);return null;}));
                try {
                    assertTrue(started.await(5,java.util.concurrent.TimeUnit.SECONDS));long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(5);boolean blocked=false;
                    while(System.nanoTime()<deadline) {
                        assertFalse(future.isDone(),"写入未等待维护主体排他锁");lockedJdbc.execute("SELECT pg_stat_clear_snapshot()");
                        blocked=Boolean.TRUE.equals(lockedJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=? AND datname=current_database() AND wait_event_type='Lock')",Boolean.class,waitingPid.get()));
                        if(blocked)break;Thread.sleep(10);
                    }
                    assertTrue(blocked,"未观察到真实数据库锁等待");
                }catch(InterruptedException e){Thread.currentThread().interrupt();throw new AssertionError(e);}
                lockedJdbc.update("UPDATE auth.maintenance_principals SET disabled=true,credential_version=credential_version+1 WHERE id=?",principal);return future;
            });
            var rejected=assertThrows(java.util.concurrent.ExecutionException.class,()->pending.get(10,java.util.concurrent.TimeUnit.SECONDS));
            assertTrue(rejected.getCause() instanceof xyz.game.datamanage.support.error.ApiException);
            assertEquals(403,((xyz.game.datamanage.support.error.ApiException)rejected.getCause()).getStatus().value());
        }finally{executor.shutdownNow();}
    }
    @Test @Order(3) void auditFailureRollsBackBusinessAndProgressAndRevocationInvalidatesExistingSession() throws Exception {
        String path="/api/admin/games/lol/skills/q",body="{\"name\":\"必须回滚\",\"description\":null,\"maxLevel\":1,\"status\":\"ENABLED\",\"sortOrder\":0,\"skillCategoryKeys\":[]}";
        String digest=json.readTree(send("GET","/internal/maintenance/games/lol/baseline",null,null,true).body()).path("baselineDigest").asText();UUID batch=UUID.randomUUID();
        assertEquals(200,send("POST","/internal/maintenance/batches",batch(batch,digest,path,body).toString(),null,true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+batch+"/open","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),false).statusCode());
        jdbc.execute("ALTER TABLE auth.maintenance_commits ADD CONSTRAINT force_fixture_failure CHECK (false) NOT VALID");
        assertEquals(500,send("PUT",path,body,Map.of("X-Damage-Maintenance-Batch",batch.toString()),true).statusCode());
        assertEquals("已验证技能",jdbc.queryForObject("SELECT name FROM public.skills WHERE game_id='lol' AND skill_key='q'",String.class));
        assertEquals(0,jdbc.queryForObject("SELECT next_operation FROM auth.maintenance_batches WHERE id=?",Integer.class,batch));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM auth.maintenance_commits WHERE batch_id=?",Integer.class,batch));
        assertEquals(503,send("GET","/api/games",null,null,false).statusCode());
        jdbc.execute("ALTER TABLE auth.maintenance_commits DROP CONSTRAINT force_fixture_failure");
        assertEquals(200,send("POST","/internal/maintenance/revoke","{}",Map.of("X-Damage-Maintenance-Token",maintenanceToken),false).statusCode());
        assertEquals(401,send("GET","/internal/maintenance/me",null,null,true).statusCode());
        assertEquals(403,send("POST","/internal/maintenance/sessions","{}",Map.of("X-Damage-Maintenance-Token",maintenanceToken),false).statusCode());
        context.getBean(MaintenanceProperties.class).setCredentialVersion(3);
        var renewed=send("POST","/internal/maintenance/sessions","{}",Map.of("X-Damage-Maintenance-Token",maintenanceToken),false);assertEquals(200,renewed.statusCode());
        for(String cookie:renewed.headers().allValues("Set-Cookie")){String[] pair=cookie.split(";",2)[0].split("=",2);cookies.put(pair[0],pair[1]);}
        UUID recovery=UUID.randomUUID();String restore=body.replace("必须回滚","恢复已验证配置");
        assertEquals(200,send("POST","/internal/maintenance/batches",batch(recovery,digest,path,restore).toString(),null,true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+batch+"/recover/"+recovery,"{}",Map.of("X-Damage-Deployment-Token",deploymentToken),false).statusCode());
        assertEquals("FAILED",jdbc.queryForObject("SELECT state FROM auth.maintenance_batches WHERE id=?",String.class,batch));
        assertEquals(503,send("GET","/api/games",null,null,false).statusCode());
        assertEquals(200,send("PUT",path,restore,Map.of("X-Damage-Maintenance-Batch",recovery.toString()),true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+recovery+"/complete","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),false).statusCode());
        assertEquals(200,send("GET","/api/games",null,null,false).statusCode());
    }
    private ObjectNode batch(UUID id,String baseline,String path,String body) throws Exception {
        ArrayNode operations=json.createArrayNode().add(json.createObjectNode().put("method","PUT").put("path",path).put("bodySha256",MaintenanceJson.sha(body.getBytes(StandardCharsets.UTF_8))));
        ObjectNode payload=json.createObjectNode().put("version","maintenance-validation-v1").put("batchId",id.toString()).put("principalId",principal.toString()).put("gameId","lol")
            .put("reference","fixture:maintenance-http").put("sourceRevision","fixture:1").put("baselineDigest",baseline).put("candidateDigest","b".repeat(64)).put("operationsDigest",MaintenanceJson.hash(json,operations))
            .put("evidenceDigest","c".repeat(64)).put("engineDigest","d".repeat(64)).put("adapterVersion","fixture-v2").put("issuedAt",Instant.now().minusSeconds(1).getEpochSecond()).put("expiresAt",Instant.now().plusSeconds(600).getEpochSecond()).put("outcome","PASSED");
        byte[] bytes=json.writeValueAsBytes(payload);var signature=Signature.getInstance("Ed25519");signature.initSign(signing.getPrivate());signature.update(bytes);
        ObjectNode envelope=json.createObjectNode().put("payload",Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)).put("signature",Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign()));
        ObjectNode request=json.createObjectNode();for(String field:java.util.List.of("batchId","gameId","reference","sourceRevision","baselineDigest","candidateDigest"))request.set(field,payload.get(field));request.set("operations",operations);request.set("receipt",envelope);return request;
    }
    private record Reply(int statusCode,String body,java.net.http.HttpHeaders headers) {}
    private Reply send(String method,String path,String body,Map<String,String> headers,boolean session) throws Exception {
        var connection=(java.net.HttpURLConnection)URI.create(base+path).toURL().openConnection();
        connection.setConnectTimeout(10000);connection.setReadTimeout(10000);connection.setRequestMethod(method);
        connection.setRequestProperty("Origin","https://localhost:5174");connection.setRequestProperty("X-Damage-Client","web");
        if(body!=null)connection.setRequestProperty("Content-Type","application/json");
        if(headers!=null)headers.forEach(connection::setRequestProperty);
        if(session){connection.setRequestProperty("Cookie",String.join("; ",cookies.entrySet().stream().map(e->e.getKey()+"="+e.getValue()).toList()));if(body!=null)connection.setRequestProperty("X-CSRF-Token",cookies.get(MaintenanceSessions.CSRF));}
        try {
            if(body!=null){connection.setDoOutput(true);try(var output=connection.getOutputStream()){output.write(body.getBytes(StandardCharsets.UTF_8));}}
            int status=connection.getResponseCode();java.io.InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();
            String response="";if(stream!=null)try(stream){response=new String(stream.readAllBytes(),StandardCharsets.UTF_8);}
            Map<String,java.util.List<String>> responseHeaders=new HashMap<>();connection.getHeaderFields().forEach((key,value)->{if(key!=null)responseHeaders.put(key,value);});
            return new Reply(status,response,java.net.http.HttpHeaders.of(responseHeaders,(key,value)->true));
        } finally {connection.disconnect();}
    }
    private static String required(String name){String value=System.getenv(name);if(value==null || value.isBlank())throw new IllegalStateException("缺少显式隔离测试配置");return value;}
    private static String random(){byte[] value=new byte[32];new java.security.SecureRandom().nextBytes(value);return Base64.getUrlEncoder().withoutPadding().encodeToString(value);}
}
