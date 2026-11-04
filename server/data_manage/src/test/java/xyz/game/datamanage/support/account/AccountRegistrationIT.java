package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** 显式隔离库：真实@Repository代理、Argon2、SQL与注册HTTP处理链，无存储模拟。 */
class AccountRegistrationIT {
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private MockMvc mvc;
    private UUID createdAccount;
    private final String name="reg_it_"+UUID.randomUUID().toString().replace("-","").substring(0,24);
    private final String source="127.31."+java.util.concurrent.ThreadLocalRandom.current().nextInt(1,255)+"."+java.util.concurrent.ThreadLocalRandom.current().nextInt(1,255);
    private String required(String name) { String value=System.getenv(name);if(value==null || value.isEmpty()) throw new IllegalStateException("缺少隔离测试配置："+name);return value; }
    @BeforeEach void setup() {
        if (!"isolated-account-tests".equals(System.getenv("ACCOUNT_IT_ALLOW_MUTATION"))) throw new IllegalStateException("仅允许显式隔离库测试");
        String database=required("ACCOUNT_IT_DATABASE_NAME"),url=required("ACCOUNT_IT_JDBC_URL");
        if (!database.matches("dv_auth_verify_20261104_[A-Za-z0-9_]+") || !url.matches(".*[/]"+java.util.regex.Pattern.quote(database)+"(?:\\?.*)?$"))
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
                        jdbc.update("DELETE FROM auth.security_events WHERE account_id=?",createdAccount);
                        jdbc.update("DELETE FROM auth.accounts WHERE id=? AND username=?",createdAccount,name);
                    }
                    jdbc.update("DELETE FROM auth.rate_limits WHERE scope='register_ip' AND subject_hash=?",AccountCrypto.hash(source));
                }
            } finally { context.close(); }
        }
    }
    @Configuration @Import({AccountService.class,AccountRateLimits.class,AccountProperties.class,AccountBrowser.class,AccountCrypto.class,PasswordTasks.class})
    static class Config {
        @Bean static PersistenceExceptionTranslationPostProcessor translation() {var p=new PersistenceExceptionTranslationPostProcessor();p.setProxyTargetClass(true);return p;}
        @Bean PersistenceExceptionTranslator translator() {return exception->null;}
        @Bean JdbcTemplate jdbc(DataSource source) {return new JdbcTemplate(source);}
        @Bean PlatformTransactionManager manager(DataSource source) {return new DataSourceTransactionManager(source);}
        @Bean AccountStore store(JdbcTemplate jdbc,PlatformTransactionManager manager) {return new AccountStore(jdbc,manager);}
        @Bean ObjectMapper json() {return org.springframework.http.converter.json.Jackson2ObjectMapperBuilder.json().featuresToDisable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();}
    }
}
