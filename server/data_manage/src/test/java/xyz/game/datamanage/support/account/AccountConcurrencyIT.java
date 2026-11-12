package xyz.game.datamanage.support.account;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;

/** 只由显式隔离库验证命令运行；默认mvn test/package不选择*IT，不读取应用默认数据库。 */
class AccountConcurrencyIT {
    private JdbcTemplate jdbc;
    private AccountStore store;
    private boolean fixtureCreated;
    private final UUID account=UUID.randomUUID(),session=UUID.randomUUID(),flow=UUID.randomUUID();
    private final String username="it_"+UUID.randomUUID().toString().replace("-","").substring(0,26);
    @BeforeEach void setup() {
        if (!"isolated-account-tests".equals(System.getenv("ACCOUNT_IT_ALLOW_MUTATION"))) throw new IllegalStateException("仅允许显式隔离库测试");
        String url=required("ACCOUNT_IT_JDBC_URL"),database=required("ACCOUNT_IT_DATABASE_NAME");
        if (!database.matches("dv_auth_verify_20261104_pg_20261105_[a-f0-9]{8}") || !url.matches(".*[/]"+java.util.regex.Pattern.quote(database)+"(?:\\?.*)?$"))
            throw new IllegalStateException("隔离库不在授权范围");
        DriverManagerDataSource source=new DriverManagerDataSource(url,required("ACCOUNT_IT_JDBC_USERNAME"),required("ACCOUNT_IT_JDBC_PASSWORD"));
        jdbc=new JdbcTemplate(source);
        if (!database.equals(jdbc.queryForObject("SELECT current_database()",String.class))) throw new IllegalStateException("隔离库名称不匹配");
        store=new AccountStore(jdbc,new DataSourceTransactionManager(source));
        store.tx(()-> {
            jdbc.update("INSERT INTO auth.accounts(id,username,password_hash,status,can_login,login_enabled_at,enablement_reference,recovery_batch_id) VALUES (?,?,'isolated-fixture','active',1,CURRENT_TIMESTAMP,?,?)",account,username,"it:"+account,UUID.randomUUID());
            jdbc.update("INSERT INTO auth.totp_credentials(account_id,secret_ciphertext,encryption_key_id,last_used_step) VALUES (?,?,'isolated-fixture',0)",account,new byte[]{1});
            jdbc.update("INSERT INTO auth.sessions(id,account_id,token_hash,csrf_hash,auth_epoch,expires_at) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP+INTERVAL '7 days')",session,account,AccountCrypto.hash("session:"+session),AccountCrypto.hash("csrf:"+session));
            jdbc.update("INSERT INTO auth.flows(id,account_id,token_hash,csrf_hash,auth_epoch,purpose,expires_at) VALUES (?,?,?,?,1,'login',CURRENT_TIMESTAMP+INTERVAL '5 minutes')",flow,account,AccountCrypto.hash("flow:"+flow),AccountCrypto.hash("csrf:"+flow));
            return null;
        });
        fixtureCreated=true;
    }
    private String required(String name) { String value=System.getenv(name);if(value==null || value.isEmpty()) throw new IllegalStateException("缺少隔离测试配置："+name);return value; }
    @AfterEach void cleanup() {
        if (fixtureCreated) {
            jdbc.update("DELETE FROM auth.accounts WHERE id=? AND username=?",account,username);
            jdbc.update("DELETE FROM auth.rate_limits WHERE scope='totp_flow' AND subject_hash=?",AccountCrypto.hash(flow.toString()));
            jdbc.update("DELETE FROM auth.rate_limits WHERE scope='totp_account' AND subject_hash=?",AccountCrypto.hash(account.toString()));
        }
    }
    @Test void twelveParallelFlowReservationsAllowExactlyFiveActualGuesses() throws Exception {
        var limits=new AccountRateLimits(store);var callers=Executors.newFixedThreadPool(12);var barrier=new java.util.concurrent.CyclicBarrier(12);
        AtomicInteger guesses=new AtomicInteger(),denied=new AtomicInteger();
        try {
            var futures=new ArrayList<java.util.concurrent.Future<?>>();
            for(int i=0;i<12;i++) futures.add(callers.submit(()-> {
                try { barrier.await(5,TimeUnit.SECONDS);limits.reserveTotp("totp_flow",flow.toString());guesses.incrementAndGet(); }
                catch (ApiException e) { assertEquals(429,e.getStatus().value());denied.incrementAndGet(); }
                catch (Exception e) { throw new AssertionError(e); }
            }));
            for(var result:futures) result.get(15,TimeUnit.SECONDS);
            assertEquals(5,guesses.get());assertEquals(7,denied.get());
            assertEquals(5,jdbc.queryForObject("SELECT attempt_count FROM auth.rate_limits WHERE scope='totp_flow' AND subject_hash=?",Integer.class,AccountCrypto.hash(flow.toString())));
        } finally { callers.shutdownNow(); }
    }
}
