package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.dao.annotation.PersistenceExceptionTranslationPostProcessor;
import org.springframework.dao.support.PersistenceExceptionTranslator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import static org.junit.jupiter.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** 显式隔离库：真实@Repository代理、数据库密码与随机材料、注册HTTP处理链。 */
class AccountRegistrationIT {
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private MockMvc mvc;
    private UUID createdAccount;
    private final java.util.Map<String,jakarta.servlet.http.Cookie> cookies=new java.util.HashMap<>();
    private String flowCsrf;
    @TempDir java.nio.file.Path temporaryKeys;
    private final String name="reg_it_"+UUID.randomUUID().toString().replace("-","").substring(0,24);
    private final String source="127.31."+java.util.concurrent.ThreadLocalRandom.current().nextInt(1,255)+"."+java.util.concurrent.ThreadLocalRandom.current().nextInt(1,255);
    private String required(String name) { String value=System.getenv(name);if(value==null || value.isEmpty()) throw new IllegalStateException("缺少隔离测试配置："+name);return value; }
    @BeforeEach void setup() {
        if (!"isolated-account-tests".equals(System.getenv("ACCOUNT_IT_ALLOW_MUTATION"))) throw new IllegalStateException("仅允许显式隔离库测试");
        String database=required("ACCOUNT_IT_DATABASE_NAME"),url=required("ACCOUNT_IT_JDBC_URL");
        if (!database.matches("dv_auth_verify_20261104_pg_20261105_[a-f0-9]{8}") || !url.matches(".*[/]"+java.util.regex.Pattern.quote(database)+"(?:\\?.*)?$"))
            throw new IllegalStateException("隔离库不在授权范围");
        var source=new DriverManagerDataSource(url,required("ACCOUNT_IT_JDBC_USERNAME"),required("ACCOUNT_IT_JDBC_PASSWORD"));
        var probe=new JdbcTemplate(source);
        if (!database.equals(probe.queryForObject("SELECT current_database()",String.class))) throw new IllegalStateException("隔离库名称不匹配");
        context=new AnnotationConfigApplicationContext();context.registerBean(DataSource.class,()->source);context.register(Config.class);context.refresh();
        jdbc=context.getBean(JdbcTemplate.class);
        AccountStore store=context.getBean(AccountStore.class);assertTrue(AopUtils.isCglibProxy(store));
        var controller=new AccountController(context.getBean(AccountService.class),context.getBean(AccountBrowser.class));
        ObjectMapper json=context.getBean(ObjectMapper.class);
        mvc=MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new AccountExceptionHandler())
            .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(json))
            .addFilters(new AdminAuthFilter(json,new AccountSessions(store),context.getBean(AccountBrowser.class))).build();
    }
    private MockHttpServletRequestBuilder credentials(String route,String password) throws Exception {
        String body=context.getBean(ObjectMapper.class).writeValueAsString(java.util.Map.of("username",name,"password",password));
        return post("/api/auth/"+route).contentType("application/json").header("Origin","https://localhost:5173").header("X-Damage-Client","web")
            .with(request->{request.setRemoteAddr(source);return request;}).content(body);
    }
    @Test void registrationAndPendingContinuationCommitThroughRealRepositoryProxy() throws Exception {
        String password="isolated-fixture-"+UUID.randomUUID();
        var response=mvc.perform(credentials("register",password)).andReturn().getResponse();
        assertEquals(200,response.getStatus());
        var body=context.getBean(ObjectMapper.class).readTree(response.getContentAsString());
        createdAccount=UUID.fromString(body.path("accountId").asText());
        assertEquals("register",body.path("purpose").asText());assertEquals("started",body.path("phase").asText());assertTrue(body.path("expiresAt").isTextual());
        assertTrue(response.getHeader(AccountBrowser.FLOW_CSRF_HEADER)!=null && response.getHeader(AccountBrowser.FLOW_CSRF_HEADER).matches("[A-Za-z0-9_-]{43}"));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.accounts WHERE id=? AND username=? AND status='pending' AND can_login=0",Integer.class,createdAccount,name));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.flows WHERE account_id=? AND purpose='register' AND phase='started'",Integer.class,createdAccount));
        var createdAt=jdbc.queryForObject("SELECT created_at FROM auth.accounts WHERE id=?",java.sql.Timestamp.class,createdAccount);
        response=mvc.perform(credentials("login",password)).andReturn().getResponse();assertEquals(200,response.getStatus());
        body=context.getBean(ObjectMapper.class).readTree(response.getContentAsString());assertEquals(createdAccount.toString(),body.path("accountId").asText());assertEquals("register",body.path("purpose").asText());
        assertEquals(createdAt,jdbc.queryForObject("SELECT created_at FROM auth.accounts WHERE id=?",java.sql.Timestamp.class,createdAccount));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.flows WHERE account_id=? AND phase='revoked'",Integer.class,createdAccount));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.flows WHERE account_id=? AND phase='started'",Integer.class,createdAccount));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM auth.security_events WHERE account_id=? AND event_type='account.register_started'",Integer.class,createdAccount));
    }
    @AfterEach void cleanup() {
        if (context!=null) {
            try {
                if(jdbc!=null) {
                    if(createdAccount==null) createdAccount=jdbc.query("SELECT id FROM auth.accounts WHERE username=?",(r,n)->r.getObject(1,UUID.class),name).stream().findFirst().orElse(null);
                    if(createdAccount!=null) {
                        for(UUID id:jdbc.queryForList("SELECT id FROM auth.flows WHERE account_id=?",UUID.class,createdAccount)) jdbc.update("DELETE FROM auth.rate_limits WHERE scope='totp_flow' AND subject_hash=?",AccountCrypto.hash(id.toString()));
                        jdbc.update("DELETE FROM auth.rate_limits WHERE scope='totp_account' AND subject_hash=?",AccountCrypto.hash(createdAccount.toString()));
                        jdbc.update("DELETE FROM auth.security_events WHERE account_id=?",createdAccount);
                        jdbc.update("DELETE FROM auth.accounts WHERE id=? AND username=?",createdAccount,name);
                    }
                    jdbc.update("DELETE FROM auth.rate_limits WHERE scope='register_ip' AND subject_hash=?",AccountCrypto.hash(source));
                }
            } finally { context.close(); }
        }
    }
    private com.fasterxml.jackson.databind.JsonNode response(MockHttpServletRequestBuilder request) throws Exception {
        if(!cookies.isEmpty()) request.cookie(cookies.values().toArray(jakarta.servlet.http.Cookie[]::new));
        if(flowCsrf!=null) request.header("X-CSRF-Token",flowCsrf);
        var response=mvc.perform(request).andReturn().getResponse();
        assertEquals(200,response.getStatus(),"账号HTTP阶段失败；不解析失败响应或输出正文");
        for(String header:response.getHeaders("Set-Cookie")) {
            String[] pair=header.split(";",2)[0].split("=",2);
            if(pair.length==2 && !pair[1].isEmpty()) cookies.put(pair[0],new jakarta.servlet.http.Cookie(pair[0],pair[1]));
            else cookies.remove(pair[0]);
        }
        if(response.getHeader(AccountBrowser.FLOW_CSRF_HEADER)!=null) flowCsrf=response.getHeader(AccountBrowser.FLOW_CSRF_HEADER);
        return context.getBean(ObjectMapper.class).readTree(response.getContentAsString());
    }
    private MockHttpServletRequestBuilder flow(String route,Object body) throws Exception {
        return post("/api/auth/"+route).contentType("application/json").header("Origin","https://localhost:5173").header("X-Damage-Client","web")
            .with(request->{request.setRemoteAddr(source);return request;}).content(context.getBean(ObjectMapper.class).writeValueAsString(body));
    }
    @Test void completeRegistrationUsesDatabaseSeedsCodesAndSessionPairThroughRealHttpChain() throws Exception {
        AuthKeyTool.create(temporaryKeys);context.getBean(AccountProperties.class).setAeadKeysetPath(temporaryKeys.resolve("aead-keyset.json"));
        String password="complete-fixture-"+UUID.randomUUID();
        var registered=response(credentials("register",password));
        assertTrue(registered.path("accountId").isTextual() && registered.path("accountId").asText().matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"),"成功注册必须返回有效账号编号");
        createdAccount=UUID.fromString(registered.path("accountId").asText());
        var setup=response(flow("flow/totp/setup",java.util.Map.of()));
        var secretMatcher=java.util.regex.Pattern.compile("[?&]secret=([A-Z2-7]{32})(?:&|$)").matcher(setup.path("otpauthUri").asText());assertTrue(secretMatcher.find());
        var hotp=new com.bastiaanjansen.otp.HOTPGenerator.Builder(secretMatcher.group(1)).build();
        long step=context.getBean(AccountStore.class).now().getEpochSecond()/30-1;
        var verified=response(flow("flow/totp/verify",java.util.Map.of("totpCode",hotp.generate(step))));assertEquals("recovery_codes_ready",verified.path("phase").asText());
        var codes=response(get("/api/auth/flow/recovery-codes"));assertEquals(10,codes.path("codes").size());
        java.util.Set<String> distinct=new java.util.HashSet<>();codes.path("codes").forEach(code->{assertTrue(code.isTextual() && code.asText().matches("[A-Za-z0-9_-]{22}"));assertTrue(distinct.add(code.asText()));});
        assertEquals("completed",response(flow("flow/recovery-codes/confirm",java.util.Map.of())).path("phase").asText());
        var store=context.getBean(AccountStore.class);new AccountMaintenance(store,context.getBean(AccountProperties.class)).enable(createdAccount,"reg-it:"+createdAccount);
        assertEquals("login",response(credentials("login",password)).path("purpose").asText());
        long used=jdbc.queryForObject("SELECT last_used_step FROM auth.totp_credentials WHERE account_id=?",Long.class,createdAccount);
        var crypto=context.getBean(AccountCrypto.class);
        String loginCode=await("等待当前时间窗口内未使用的动态码")
            .pollDelay(Duration.ZERO).pollInterval(Duration.ofMillis(100)).atMost(Duration.ofSeconds(35))
            .until(()-> {
                var now=store.now();long current=now.getEpochSecond()/30;
                for(long candidate:new long[]{current,current+1,current-1}) {
                    if(candidate<=used) continue;
                    String code=hotp.generate(candidate);
                    if(crypto.matchingStep(secretMatcher.group(1),code,now,used)>used) return code;
                }
                return null;
            },java.util.Objects::nonNull);
        var logged=response(flow("login/totp",java.util.Map.of("totpCode",loginCode)));assertEquals(1,logged.path("canLogin").asInt());assertEquals(createdAccount.toString(),logged.path("accountId").asText());
        assertTrue(cookies.containsKey(AccountBrowser.SESSION) && cookies.containsKey(AccountBrowser.CSRF));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.accounts WHERE id=? AND status='active' AND password_hash ~ '^\\$2a\\$10\\$[./A-Za-z0-9]{53}$'",Integer.class,createdAccount));
        assertEquals(10,jdbc.queryForObject("SELECT count(*) FROM auth.recovery_codes WHERE account_id=? AND octet_length(code_hash)=32",Integer.class,createdAccount));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM auth.sessions WHERE account_id=? AND octet_length(token_hash)=32 AND octet_length(csrf_hash)=32 AND revoked_at IS NULL",Integer.class,createdAccount));
    }
    @Configuration @Import({AccountService.class,AccountRateLimits.class,AccountProperties.class,AccountBrowser.class,AccountCrypto.class,PasswordTasks.class,AccountDatabaseCrypto.class})
    static class Config {
        @Bean static PersistenceExceptionTranslationPostProcessor translation() {var p=new PersistenceExceptionTranslationPostProcessor();p.setProxyTargetClass(true);return p;}
        @Bean PersistenceExceptionTranslator translator() {return exception->null;}
        @Bean JdbcTemplate jdbc(DataSource source) {return new JdbcTemplate(source);}
        @Bean PlatformTransactionManager manager(DataSource source) {return new DataSourceTransactionManager(source);}
        @Bean AccountStore store(JdbcTemplate jdbc,PlatformTransactionManager manager) {return new AccountStore(jdbc,manager);}
        @Bean ObjectMapper json() {return org.springframework.http.converter.json.Jackson2ObjectMapperBuilder.json().featuresToDisable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();}
    }
}
