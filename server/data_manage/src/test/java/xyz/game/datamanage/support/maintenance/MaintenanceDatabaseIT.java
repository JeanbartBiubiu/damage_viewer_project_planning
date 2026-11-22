package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.InetAddress;
import java.net.ServerSocket;
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
import java.time.Duration;
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

/** 仅连接一次性本机测试集群，覆盖真实服务、事务和独立读回。 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class MaintenanceDatabaseIT {
    private final ObjectMapper json=new ObjectMapper();
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final UUID principal=UUID.randomUUID();
    private static final String ORIGIN = "https://localhost:5174";
    private static final String PUBLIC_ORIGIN = "https://localhost:5173";
    private Path root,temporary;
    private ConfigurableApplicationContext context;
    private JdbcTemplate jdbc;
    private String publicBase, privateBase, deploymentToken, accountToken;
    private KeyPair signing;
    @BeforeAll void setup() throws Exception {
        String marker = System.getenv("DAMAGE_MAINTENANCE_IT_FIXTURE");
        String port = System.getenv("DAMAGE_MAINTENANCE_IT_PORT");
        if (marker == null || !marker.matches("[0-9a-f]{32}") || port == null || !port.matches("[1-9][0-9]{0,4}")
            || Integer.parseInt(port) > 65535) throw new IllegalStateException("必须显式提供一次性隔离测试集群标记及端口");
        root=Path.of("../..").toAbsolutePath().normalize();
        String url = "jdbc:postgresql://127.0.0.1:" + port + "/test0221?connectTimeout=5&sslmode=disable";
        String username = "damage_viewer_test_app";
        try (Connection connection = DriverManager.getConnection(url, username, ""); var statement = connection.createStatement();
             var result = statement.executeQuery("""
                 SELECT current_database(), session_user, current_user, current_setting('damage.maintenance_fixture', true),
                        to_regnamespace('auth') IS NULL AND to_regclass('public.games') IS NULL
                 """)) {
            if (!result.next() || !"test0221".equals(result.getString(1)) || !username.equals(result.getString(2))
                || !username.equals(result.getString(3)) || !marker.equals(result.getString(4)) || !result.getBoolean(5)) {
                throw new IllegalStateException("隔离测试目标身份或初始结构不匹配");
            }
        }
        try {
            jdbc = new JdbcTemplate(new DriverManagerDataSource(url, username, ""));
            for(String file:java.util.List.of("db/game_manage/schema.sql","db/game_manage/triggers.sql","db/user_manage/schema.sql","db/visit_statistics/schema.sql"))
                jdbc.execute(Files.readString(root.resolve(file)));
            jdbc.update("INSERT INTO public.games(game_id,game_name) VALUES ('lol','隔离验证')");
            jdbc.update("INSERT INTO public.skills(game_id,skill_key,name,max_level,status,sort_order) VALUES ('lol','q','原技能',1,'ENABLED',0)");
            temporary=Files.createTempDirectory("damage-maintenance-it-");
            deploymentToken = random();
            accountToken = random();
            Files.writeString(temporary.resolve("deployment-fixture"), deploymentToken);
            Files.writeString(temporary.resolve("account-fixture"), accountToken);
            signing=KeyPairGenerator.getInstance("Ed25519").generateKeyPair();Files.write(temporary.resolve("validation-public.der"),signing.getPublic().getEncoded());
            var grant=KeyPairGenerator.getInstance("Ed25519").generateKeyPair();Files.write(temporary.resolve("grant.pk8"),grant.getPrivate().getEncoded());
            Map<String,Object> settings=new HashMap<>();settings.put("server.port",0);settings.put("server.address","127.0.0.1");
            settings.put("spring.datasource.url", url);settings.put("spring.datasource.username",username);settings.put("spring.datasource.password", "");
            settings.put("app.auth.cleanup-enabled",false);settings.put("app.auth.grant-private-key-path",temporary.resolve("grant.pk8").toString());
            settings.put("app.auth.allowed-origins", PUBLIC_ORIGIN);
            settings.put("app.auth.internal-token-path",temporary.resolve("account-fixture").toString());
            settings.put("app.maintenance.principal-id",principal.toString());
            settings.put("app.maintenance.allowed-origins", ORIGIN);
            settings.put("app.maintenance.deployment-token-path",temporary.resolve("deployment-fixture").toString());settings.put("app.maintenance.validation-public-key-path",temporary.resolve("validation-public.der").toString());
            int privatePort;
            try (var reserved = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) { privatePort = reserved.getLocalPort(); }
            settings.put("APP_MAINTENANCE_DEV_PORT", privatePort);
            settings.put("logging.level.root","ERROR");settings.put("spring.main.banner-mode","off");
            context=new SpringApplicationBuilder(DataManageApplication.class).web(WebApplicationType.SERVLET)
                .initializers(ctx->ctx.getEnvironment().getPropertySources().addFirst(new MapPropertySource("isolated-maintenance",settings)))
                .run("--spring.config.location=classpath:/application.yml");
            publicBase = "http://127.0.0.1:"+((ServletWebServerApplicationContext)context).getWebServer().getPort();
            privateBase = "http://127.0.0.1:" + privatePort;
        } catch(Exception e) {cleanup();throw new IllegalStateException("隔离维护测试初始化失败："+e.getClass().getSimpleName());}
    }
    @AfterAll void cleanup() throws Exception {
        if(context!=null){context.close();context=null;}
        if (temporary != null) {
            try (var paths = Files.list(temporary)) { for (Path file : paths.toList()) Files.delete(file); }
            Files.delete(temporary);
            temporary = null;
        }
    }
    @Test @Order(1) void bothExistingSchemasMigrateWithPlayerAndMaintenanceReferencesIntact() throws Exception {
        UUID account = UUID.randomUUID(), session = UUID.randomUUID();
        UUID historicalPrincipal = UUID.randomUUID(), historicalBatch = UUID.randomUUID();
        var currentForeignKeys = maintenanceForeignKeys();
        jdbc.execute("ALTER TABLE \"user\".edit_log DROP COLUMN maintenance_principal_id; DROP TABLE auth.maintenance_commits; DROP TABLE auth.maintenance_batches; DROP TABLE auth.maintenance_principals; ALTER TABLE auth.accounts ADD COLUMN can_edit boolean NOT NULL DEFAULT false");
        jdbc.update("INSERT INTO auth.accounts(id,username,password_hash,status,can_login,can_edit) VALUES (?,'migration_fixture','fixture','pending',0,true)",account);
        jdbc.update("INSERT INTO auth.sessions(id,account_id,token_hash,csrf_hash,auth_epoch,expires_at) VALUES (?,?,decode(repeat('ab',32),'hex'),decode(repeat('cd',32),'hex'),1,CURRENT_TIMESTAMP+INTERVAL '30 days')",session,account);
        jdbc.update("INSERT INTO \"user\".edit_log(account_id,username_snapshot,edit_body) VALUES (?,'migration_fixture','{}')",account);
        jdbc.execute(Files.readString(root.resolve("db/user_manage/migrations/20261113_viewer_maintenance_identity.sql")));
        String upgrade = Files.readString(root.resolve("db/user_manage/migrations/20261122_maintenance_private_ingress.sql"));
        jdbc.execute(upgrade);
        assertEquals(currentForeignKeys, maintenanceForeignKeys());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema='auth' AND table_name='accounts' AND column_name='can_edit'",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.accounts WHERE id=? AND username='migration_fixture'",Integer.class,account));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.sessions WHERE id=? AND revoked_at IS NULL",Integer.class,session));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM \"user\".edit_log WHERE account_id=? AND maintenance_principal_id IS NULL",Integer.class,account));

        // 再现上一版云测试库的维护表形状，并带上独立主体、旧会话和维护历史。
        jdbc.execute("ALTER TABLE \"user\".edit_log DROP COLUMN maintenance_principal_id; DROP TABLE auth.maintenance_commits; DROP TABLE auth.maintenance_batches; DROP TABLE auth.maintenance_principals; ALTER TABLE auth.accounts ADD COLUMN can_edit boolean NOT NULL DEFAULT false");
        jdbc.execute(Files.readString(root.resolve("db/user_manage/migrations/20261113_viewer_maintenance_identity.sql")));
        jdbc.update("INSERT INTO auth.maintenance_principals(id,display_name,credential_version,token_hash,disabled) VALUES (?,'历史主体',2,decode(repeat('ab',32),'hex'),true)", historicalPrincipal);
        jdbc.update("""
            INSERT INTO auth.maintenance_sessions(id,principal_id,credential_version,token_hash,csrf_hash,created_at,expires_at)
            VALUES (?,?,2,decode(repeat('ab',32),'hex'),decode(repeat('cd',32),'hex'),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '30 minutes')
            """, UUID.randomUUID(), historicalPrincipal);
        jdbc.update("""
            INSERT INTO auth.maintenance_batches(id,principal_id,game_id,reference,source_revision,baseline_digest,candidate_digest,current_digest,operations,receipt,state,next_operation)
            VALUES (?,?,'lol','fixture','fixture',repeat('a',64),repeat('b',64),repeat('c',64),'[{}]','{}','COMPLETE',1)
            """, historicalBatch, historicalPrincipal);
        jdbc.update("""
            INSERT INTO auth.maintenance_commits(batch_id,operation_index,principal_id,method,path,body_sha256,before_digest,after_digest)
            VALUES (?,0,?,'PATCH','/fixture',repeat('a',64),repeat('b',64),repeat('c',64))
            """, historicalBatch, historicalPrincipal);
        jdbc.update("INSERT INTO \"user\".edit_log(username_snapshot,edit_body,maintenance_principal_id) VALUES ('历史主体','{}',?)", historicalPrincipal);
        jdbc.execute(upgrade);
        assertNull(jdbc.queryForObject("SELECT to_regclass('auth.maintenance_sessions')::text", String.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema='auth' AND table_name='maintenance_principals' AND column_name IN ('credential_version','token_hash')", Integer.class));
        assertEquals(currentForeignKeys, maintenanceForeignKeys());
        assertEquals("历史主体", jdbc.queryForObject("SELECT display_name FROM auth.maintenance_principals WHERE id=? AND disabled", String.class, historicalPrincipal));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM auth.maintenance_commits c JOIN auth.maintenance_batches b ON c.batch_id=b.id WHERE c.principal_id=b.principal_id AND c.batch_id=? AND c.principal_id=?", Integer.class, historicalBatch, historicalPrincipal));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM \"user\".edit_log WHERE maintenance_principal_id=?", Integer.class, historicalPrincipal));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM auth.sessions WHERE account_id=? AND id=?", Integer.class, account, session));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
            () -> jdbc.update("DELETE FROM auth.maintenance_principals WHERE id=?", historicalPrincipal));

        assertEquals(403, send("GET", "/internal/maintenance/me", null, null, true).statusCode());
        jdbc.update("INSERT INTO auth.maintenance_principals(id,display_name) VALUES (?,'隔离维护')", principal);
    }

    private java.util.List<String> maintenanceForeignKeys() {
        return jdbc.queryForList("""
            SELECT conrelid::regclass::text || ' ' || pg_get_constraintdef(oid) FROM pg_constraint
            WHERE contype='f' AND convalidated AND conrelid IN ('auth.maintenance_batches'::regclass,
              'auth.maintenance_commits'::regclass, '"user".edit_log'::regclass, 'auth.sessions'::regclass)
            ORDER BY 1
            """, String.class);
    }
    @Test @Order(2) void realHttpRequiresSignedBatchAndCommitsDataAuditAndProgressTogether() throws Exception {
        assertEquals(200,send("GET","/api/games",null,null,false).statusCode());
        String path="/api/admin/games/lol/skills/q",body="{\"name\":\"已验证技能\",\"description\":null,\"maxLevel\":1,\"status\":\"ENABLED\",\"sortOrder\":0,\"skillCategoryKeys\":[]}";
        assertEquals(403, send("PUT", path, body, null, false).statusCode());
        String me = "/internal/maintenance/me";
        assertEquals(403, send("GET", me, null, Map.of("Forwarded", "for=127.0.0.1;proto=https", "X-Forwarded-For", "127.0.0.1"), false).statusCode());
        var identity = send("GET", me, null, null, true);
        assertEquals(200, identity.statusCode());
        assertEquals(json.valueToTree(Map.of("principalId", principal, "displayName", "隔离维护")), json.readTree(identity.body()));
        assertTrue(identity.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(200, sendRequest("GET", me, null, Map.of("Sec-Fetch-Site", "same-origin"), true).statusCode());
        assertEquals(403, sendRequest("GET", me, null, Map.of(), true).statusCode());
        for (String retired : java.util.List.of("sessions", "logout", "revoke")) {
            assertEquals(403, send("POST", "/internal/maintenance/" + retired, "{}", null, true).statusCode());
        }
        var grant=send("POST","/internal/maintenance/wasm-grant","{}",null,true);assertEquals(200,grant.statusCode());
        assertEquals(403,send("GET","/api/admin/visits/last30days",null,null,true).statusCode());
        assertEquals(200,send("GET","/api/admin/visits/last30days",null,Map.of("X-Damage-Deployment-Token", deploymentToken),false).statusCode());
        assertEquals(403,send("GET","/api/admin/visits/last30days",null,Map.of("X-Damage-Deployment-Token", accountToken),false).statusCode());
        assertEquals(401,send("POST","/internal/accounts/"+UUID.randomUUID()+"/enable-login","{\"enablementReference\":\"fixture\"}",Map.of("X-Damage-Internal-Token", deploymentToken),false).statusCode());
        JsonNode claims=json.readTree(Base64.getUrlDecoder().decode(json.readTree(grant.body()).path("grant").asText().split("\\.")[1]));
        assertEquals("MAINTENANCE", claims.path("subjectType").asText());
        assertEquals(principal.toString(), claims.path("sub").asText());
        assertFalse(claims.has("canLogin"));
        assertEquals(2, claims.path("authorizationVersion").asInt());
        assertEquals(1800, claims.path("exp").asLong() - claims.path("iat").asLong());
        assertEquals(403,send("PUT",path,body,null,true).statusCode());
        String digest=json.readTree(send("GET","/internal/maintenance/games/lol/baseline",null,null,true).body()).path("baselineDigest").asText();
        UUID batch=UUID.randomUUID();ObjectNode request=batch(batch,digest,path,body);
        assertEquals(403, send("POST", "/internal/maintenance/batches", request.toString(), null, false).statusCode());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM auth.maintenance_batches WHERE id=?", Integer.class, batch));
        assertEquals(200,send("POST","/internal/maintenance/batches",request.toString(),null,true).statusCode());
        String open = "/internal/maintenance/batches/" + batch + "/open";
        var deploymentHeaders = Map.of("X-Damage-Deployment-Token", deploymentToken);
        assertEquals(403, send("POST", open, "{}", null, true).statusCode());
        assertEquals(403, send("POST", open, "{}", deploymentHeaders, false).statusCode());
        jdbc.update("UPDATE auth.maintenance_principals SET disabled=true WHERE id=?", principal);
        assertEquals(403, send("POST", open, "{}", deploymentHeaders, true).statusCode());
        assertEquals("PREPARED", jdbc.queryForObject("SELECT state FROM auth.maintenance_batches WHERE id=?", String.class, batch));
        assertEquals(200, send("GET", "/api/games", null, null, false).statusCode());
        jdbc.update("UPDATE auth.maintenance_principals SET disabled=false WHERE id=?", principal);
        assertEquals(200, send("POST", open, "{}", deploymentHeaders, true).statusCode());
        assertEquals(503,send("GET","/api/games",null,null,false).statusCode());
        assertEquals(503,send("POST","/api/auth/wasm-grant","{}",Map.of("Origin", PUBLIC_ORIGIN),false).statusCode());
        assertEquals(200,send("GET","/api/games",null,null,true).statusCode());
        String images = "/api/games/lol/images";
        assertEquals(503,send("GET",images,null,null,false).statusCode());
        var imageRead = sendRequest("GET", images, null, Map.of("Sec-Fetch-Site", "same-origin"), true);
        assertEquals(200, imageRead.statusCode());
        assertTrue(imageRead.headers().allValues("Access-Control-Allow-Origin").isEmpty());
        assertEquals(403, send("GET", images, null, Map.of("Sec-Fetch-Site", "cross-site"), true).statusCode());
        assertEquals(403, send("PUT", path, body, Map.of("Sec-Fetch-Site", "same-site"), true).statusCode());
        assertEquals(409,send("PUT",path,body+" ",Map.of("X-Damage-Maintenance-Batch",batch.toString()),true).statusCode());
        assertEquals("原技能",jdbc.queryForObject("SELECT name FROM public.skills WHERE game_id='lol' AND skill_key='q'",String.class));
        assertEquals(200,send("PUT",path,body,Map.of("X-Damage-Maintenance-Batch",batch.toString()),true).statusCode());
        assertEquals("已验证技能",jdbc.queryForObject("SELECT name FROM public.skills WHERE game_id='lol' AND skill_key='q'",String.class));
        assertEquals(1,jdbc.queryForObject("SELECT next_operation FROM auth.maintenance_batches WHERE id=?",Integer.class,batch));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.maintenance_commits WHERE batch_id=? AND principal_id=?",Integer.class,batch,principal));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM \"user\".edit_log WHERE maintenance_principal_id=?",Integer.class,principal));
        assertEquals(409,send("PUT",path,body,Map.of("X-Damage-Maintenance-Batch",batch.toString()),true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+batch+"/complete","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),true).statusCode());
        assertEquals(200,send("GET","/api/games",null,null,false).statusCode());
    }
    @Test @Order(3) void referenceSynchronizationPrecedesCommitDigestAndItsFailureRollsBackTheWholeWrite() throws Exception {
        String path="/api/admin/games/lol/skills/q/configuration";
        String body=referenceConfiguration("recorded",path);
        String before=currentDigest();UUID accepted=UUID.randomUUID();
        assertEquals(200,send("POST","/internal/maintenance/batches",batch(accepted,before,"PATCH",path,body).toString(),null,true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+accepted+"/open","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),true).statusCode());
        Reply written=send("PATCH",path,body,Map.of("X-Damage-Maintenance-Batch",accepted.toString()),true);
        assertEquals(200,written.statusCode(),written.body());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.skill_object_references WHERE game_id='lol' AND source_key='recorded_formula' AND target_key='recorded_value'",Integer.class));
        String finalDigest=currentDigest();assertNotEquals(before,finalDigest);
        assertEquals(finalDigest,jdbc.queryForObject("SELECT current_digest FROM auth.maintenance_batches WHERE id=?",String.class,accepted));
        assertEquals(finalDigest,jdbc.queryForObject("SELECT after_digest FROM auth.maintenance_commits WHERE batch_id=?",String.class,accepted));
        assertEquals(200,send("POST","/internal/maintenance/batches/"+accepted+"/complete","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),true).statusCode());

        String rejectedBody=referenceConfiguration("rollback",path);UUID rejected=UUID.randomUUID();
        int auditBefore=jdbc.queryForObject("SELECT count(*) FROM \"user\".edit_log",Integer.class);
        int referencesBefore=jdbc.queryForObject("SELECT count(*) FROM public.skill_object_references",Integer.class);
        assertEquals(200,send("POST","/internal/maintenance/batches",batch(rejected,finalDigest,"PATCH",path,rejectedBody).toString(),null,true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+rejected+"/open","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),true).statusCode());
        jdbc.execute("ALTER TABLE public.skill_object_references ADD CONSTRAINT force_reference_fixture_failure CHECK (source_key<>'rollback_formula') NOT VALID");
        try {
            assertEquals(500,send("PATCH",path,rejectedBody,Map.of("X-Damage-Maintenance-Batch",rejected.toString()),true).statusCode());
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM public.skill_parameters WHERE parameter_key='rollback_value'",Integer.class));
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM public.skill_formulas WHERE formula_key='rollback_formula'",Integer.class));
            assertEquals(referencesBefore,jdbc.queryForObject("SELECT count(*) FROM public.skill_object_references",Integer.class));
            assertEquals(auditBefore,jdbc.queryForObject("SELECT count(*) FROM \"user\".edit_log",Integer.class));
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM auth.maintenance_commits WHERE batch_id=?",Integer.class,rejected));
            assertEquals(0,jdbc.queryForObject("SELECT next_operation FROM auth.maintenance_batches WHERE id=?",Integer.class,rejected));
            assertEquals(finalDigest,currentDigest());
        } finally {jdbc.execute("ALTER TABLE public.skill_object_references DROP CONSTRAINT force_reference_fixture_failure");}
        // 已通过独立读取证明整笔回滚，移除本用例的强制失败后，才提交原冻结请求。
        assertEquals(200,send("PATCH",path,rejectedBody,Map.of("X-Damage-Maintenance-Batch",rejected.toString()),true).statusCode());
        assertEquals(currentDigest(),jdbc.queryForObject("SELECT current_digest FROM auth.maintenance_batches WHERE id=?",String.class,rejected));
        assertEquals(200,send("POST","/internal/maintenance/batches/"+rejected+"/complete","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),true).statusCode());
    }
    private String currentDigest() throws Exception {
        return json.readTree(send("GET","/internal/maintenance/games/lol/baseline",null,null,true).body()).path("baselineDigest").asText();
    }
    private String referenceConfiguration(String prefix,String path) throws Exception {
        ObjectNode request=json.createObjectNode().put("baseDigest",json.readTree(send("GET",path,null,null,true).body()).path("baseDigest").asText());
        ArrayNode changes=request.putArray("changes");
        ObjectNode parameter=changes.addObject().put("objectType","PARAMETER").put("operation","CREATE").put("key",prefix+"_value").putObject("value");
        parameter.put("parameterKey",prefix+"_value").put("name",prefix+"数值").put("valueType","DECIMAL").put("valueMode","FIXED").put("fixedValue",42).putNull("levelValues").putNull("description").put("sortOrder",0);
        ObjectNode formula=changes.addObject().put("objectType","FORMULA").put("operation","CREATE").put("key",prefix+"_formula").putObject("value");
        formula.put("formulaKey",prefix+"_formula").put("name",prefix+"公式").putNull("description").put("sortOrder",0);
        ObjectNode expression=formula.putObject("expression").put("outputStageKey","output");
        expression.putArray("inputs").addObject().put("key","input_0").putObject("binding").put("kind","parameter").put("skillKey","q").put("parameterKey",prefix+"_value");
        expression.putArray("stages").addObject().put("key","output").put("name","输出").putObject("expression").put("op","read").put("inputKey","input_0");
        return request.toString();
    }
    @Test @Order(5) void transactionWaitingForPrincipalLockRechecksEnabledStatus() throws Exception {
        var store=context.getBean(xyz.game.datamanage.support.account.AccountStore.class);
        var principals=context.getBean(MaintenancePrincipals.class);
        var lockedJdbc=store.jdbc();
        var identity = new MaintenancePrincipal(principal, "隔离维护");
        var executor=java.util.concurrent.Executors.newSingleThreadExecutor();var started=new java.util.concurrent.CountDownLatch(1);var waitingPid=new java.util.concurrent.atomic.AtomicInteger();
        try {
            var pending=store.tx(()-> {
                lockedJdbc.queryForObject("SELECT id FROM auth.maintenance_principals WHERE id=? FOR UPDATE",UUID.class,principal);
                var future=executor.submit(()->store.tx(()-> {waitingPid.set(lockedJdbc.queryForObject("SELECT pg_backend_pid()",Integer.class));started.countDown();principals.lock(identity);return null;}));
                try {
                    assertTrue(started.await(5,java.util.concurrent.TimeUnit.SECONDS));long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(5);boolean blocked=false;
                    while(System.nanoTime()<deadline) {
                        assertFalse(future.isDone(),"写入未等待维护主体排他锁");lockedJdbc.execute("SELECT pg_stat_clear_snapshot()");
                        blocked=Boolean.TRUE.equals(lockedJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=? AND datname=current_database() AND wait_event_type='Lock')",Boolean.class,waitingPid.get()));
                        if(blocked)break;Thread.sleep(10);
                    }
                    assertTrue(blocked,"未观察到真实数据库锁等待");
                }catch(InterruptedException e){Thread.currentThread().interrupt();throw new AssertionError(e);}
                lockedJdbc.update("UPDATE auth.maintenance_principals SET disabled=true WHERE id=?",principal);return future;
            });
            var rejected=assertThrows(java.util.concurrent.ExecutionException.class,()->pending.get(10,java.util.concurrent.TimeUnit.SECONDS));
            assertTrue(rejected.getCause() instanceof xyz.game.datamanage.support.error.ApiException);
            assertEquals(403,((xyz.game.datamanage.support.error.ApiException)rejected.getCause()).getStatus().value());
        }finally{executor.shutdownNow();}
    }
    @Test @Order(4) void auditFailureRollsBackBusinessAndProgressAndDisabledPrincipalCannotUseThePrivateIngress() throws Exception {
        String path="/api/admin/games/lol/skills/q",body="{\"name\":\"必须回滚\",\"description\":null,\"maxLevel\":1,\"status\":\"ENABLED\",\"sortOrder\":0,\"skillCategoryKeys\":[]}";
        String digest=json.readTree(send("GET","/internal/maintenance/games/lol/baseline",null,null,true).body()).path("baselineDigest").asText();UUID batch=UUID.randomUUID();
        assertEquals(200,send("POST","/internal/maintenance/batches",batch(batch,digest,path,body).toString(),null,true).statusCode());
        assertEquals(200,send("POST","/internal/maintenance/batches/"+batch+"/open","{}",Map.of("X-Damage-Deployment-Token",deploymentToken),true).statusCode());
        jdbc.execute("ALTER TABLE auth.maintenance_commits ADD CONSTRAINT force_fixture_failure CHECK (false) NOT VALID");
        assertEquals(500,send("PUT",path,body,Map.of("X-Damage-Maintenance-Batch",batch.toString()),true).statusCode());
        assertEquals("已验证技能",jdbc.queryForObject("SELECT name FROM public.skills WHERE game_id='lol' AND skill_key='q'",String.class));
        assertEquals(0,jdbc.queryForObject("SELECT next_operation FROM auth.maintenance_batches WHERE id=?",Integer.class,batch));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM auth.maintenance_commits WHERE batch_id=?",Integer.class,batch));
        assertEquals(503,send("GET","/api/games",null,null,false).statusCode());
        jdbc.execute("ALTER TABLE auth.maintenance_commits DROP CONSTRAINT force_fixture_failure");
        jdbc.update("UPDATE auth.maintenance_principals SET disabled=true WHERE id=?", principal);
        assertEquals(403, send("GET", "/internal/maintenance/me", null, null, true).statusCode());
        assertEquals(403, send("GET", "/api/games", null, null, true).statusCode());
        assertEquals(403, send("POST", "/internal/maintenance/wasm-grant", "{}", null, true).statusCode());
        assertEquals(403, send("POST", "/internal/maintenance/batches/" + batch + "/renew", "{}", null, true).statusCode());
        assertEquals(403, send("PUT", path, body, Map.of("X-Damage-Maintenance-Batch", batch.toString()), true).statusCode());

        UUID recoveryPrincipal = UUID.randomUUID(), recovery = UUID.randomUUID();
        jdbc.update("INSERT INTO auth.maintenance_principals(id,display_name) VALUES (?,'恢复主体')", recoveryPrincipal);
        var properties = context.getBean(MaintenanceProperties.class);
        properties.setPrincipalId(recoveryPrincipal);
        try {
            String restore = body.replace("必须回滚", "恢复已验证配置");
            var deploymentHeaders = Map.of("X-Damage-Deployment-Token", deploymentToken);
            String recover = "/internal/maintenance/batches/" + batch + "/recover/" + recovery;
            assertEquals(200, send("POST", "/internal/maintenance/batches", batch(recovery,digest,path,restore).toString(), null, true).statusCode());
            jdbc.update("UPDATE auth.maintenance_principals SET disabled=true WHERE id=?", recoveryPrincipal);
            assertEquals(403, send("POST", recover, "{}", deploymentHeaders, true).statusCode());
            assertEquals("OPEN", jdbc.queryForObject("SELECT state FROM auth.maintenance_batches WHERE id=?", String.class, batch));
            assertEquals("PREPARED", jdbc.queryForObject("SELECT state FROM auth.maintenance_batches WHERE id=?", String.class, recovery));
            assertEquals(503, send("GET", "/api/games", null, null, false).statusCode());
            jdbc.update("UPDATE auth.maintenance_principals SET disabled=false WHERE id=?", recoveryPrincipal);
            assertEquals(200, send("POST", recover, "{}", deploymentHeaders, true).statusCode());
            assertEquals("FAILED", jdbc.queryForObject("SELECT state FROM auth.maintenance_batches WHERE id=?", String.class, batch));
            assertEquals("OPEN", jdbc.queryForObject("SELECT state FROM auth.maintenance_batches WHERE id=?", String.class, recovery));
            assertEquals(503, send("GET", "/api/games", null, null, false).statusCode());
            assertEquals(200, send("PUT", path, restore, Map.of("X-Damage-Maintenance-Batch", recovery.toString()), true).statusCode());
            assertEquals(200, send("POST", "/internal/maintenance/batches/" + recovery + "/complete", "{}", deploymentHeaders, true).statusCode());
            assertEquals(200, send("GET", "/api/games", null, null, false).statusCode());
        } finally {
            properties.setPrincipalId(principal);
            jdbc.update("UPDATE auth.maintenance_principals SET disabled=false WHERE id=?", principal);
        }
    }
    private ObjectNode batch(UUID id,String baseline,String path,String body) throws Exception {
        return batch(id,baseline,"PUT",path,body);
    }
    private ObjectNode batch(UUID id,String baseline,String method,String path,String body) throws Exception {
        ArrayNode operations=json.createArrayNode().add(json.createObjectNode().put("method",method).put("path",path).put("bodySha256",MaintenanceJson.sha(body.getBytes(StandardCharsets.UTF_8))));
        UUID signerSubject = context.getBean(MaintenanceProperties.class).getPrincipalId();
        ObjectNode payload=json.createObjectNode().put("version","maintenance-validation-v1").put("batchId",id.toString()).put("principalId",signerSubject.toString()).put("gameId","lol")
            .put("reference","fixture:maintenance-http").put("sourceRevision","fixture:1").put("baselineDigest",baseline).put("candidateDigest","b".repeat(64)).put("operationsDigest",MaintenanceJson.hash(json,operations))
            .put("evidenceDigest","c".repeat(64)).put("engineDigest","d".repeat(64)).put("adapterVersion","fixture-v2").put("issuedAt",Instant.now().minusSeconds(1).getEpochSecond()).put("expiresAt",Instant.now().plusSeconds(600).getEpochSecond()).put("outcome","PASSED");
        byte[] bytes=json.writeValueAsBytes(payload);var signature=Signature.getInstance("Ed25519");signature.initSign(signing.getPrivate());signature.update(bytes);
        ObjectNode envelope=json.createObjectNode().put("payload",Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)).put("signature",Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign()));
        ObjectNode request=json.createObjectNode();for(String field:java.util.List.of("batchId","gameId","reference","sourceRevision","baselineDigest","candidateDigest"))request.set(field,payload.get(field));request.set("operations",operations);request.set("receipt",envelope);return request;
    }
    private record Reply(int statusCode,String body,java.net.http.HttpHeaders headers) {}
    private Reply send(String method, String path, String body, Map<String,String> headers, boolean privateIngress) throws Exception {
        var cliHeaders = new HashMap<>(Map.of("Origin", ORIGIN, "X-Damage-Client", "web"));
        if (headers != null) cliHeaders.putAll(headers);
        return sendRequest(method, path, body, cliHeaders, privateIngress);
    }

    private Reply sendRequest(String method, String path, String body, Map<String,String> headers, boolean privateIngress) throws Exception {
        String base = privateIngress ? privateBase : publicBase;
        var builder = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(30));
        headers.forEach(builder::header);
        if (body != null) builder.header("Content-Type", "application/json");
        var publisher = body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body);
        var response = client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString());
        return new Reply(response.statusCode(), response.body(), response.headers());
    }
    private static String random(){byte[] value=new byte[32];new java.security.SecureRandom().nextBytes(value);return Base64.getUrlEncoder().withoutPadding().encodeToString(value);}
}
