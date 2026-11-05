package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;

/** 显式隔离库的真实并发回归；不会读取默认连接，不由普通test/package自动选取。 */
class PasswordParallelIT {
    private DriverManagerDataSource source;
    private JdbcTemplate jdbc;
    private AccountStore store;
    private AccountRateLimits limits;
    private final List<Identity> identities=new ArrayList<>();
    private record Identity(UUID id,String username,String address) {}
    private String required(String name) {String value=System.getenv(name);if(value==null || value.isEmpty())throw new IllegalStateException("缺少隔离测试配置："+name);return value;}
    @BeforeEach void setup() {
        if(!"isolated-account-tests".equals(System.getenv("ACCOUNT_IT_ALLOW_MUTATION")))throw new IllegalStateException("需要显式隔离测试授权");
        String name=required("ACCOUNT_IT_DATABASE_NAME"),url=required("ACCOUNT_IT_JDBC_URL");
        if(!name.matches("dv_auth_verify_20261104_pg_20261105_[a-f0-9]{8}") || !url.matches(".*[/]"+java.util.regex.Pattern.quote(name)+"(?:\\?.*)?$"))throw new IllegalStateException("隔离库不在授权范围");
        source=new DriverManagerDataSource(url,required("ACCOUNT_IT_JDBC_USERNAME"),required("ACCOUNT_IT_JDBC_PASSWORD"));jdbc=new JdbcTemplate(source);
        if(!name.equals(jdbc.queryForObject("SELECT current_database()",String.class)))throw new IllegalStateException("隔离库名称不匹配");
        store=new AccountStore(jdbc,new DataSourceTransactionManager(source));limits=new AccountRateLimits(store);
    }
    private Identity identity() {
        UUID id=UUID.randomUUID();var row=new Identity(id,"parallel_"+id.toString().replace("-","").substring(0,20),"127.50."+ThreadLocalRandom.current().nextInt(1,255)+"."+ThreadLocalRandom.current().nextInt(1,255));identities.add(row);return row;
    }
    private void account(Identity row,String encoded) {jdbc.update("INSERT INTO auth.accounts(id,username,password_hash) VALUES (?,?,?)",row.id(),row.username(),encoded);}
    private byte[] hash(Identity row,String scope) {return AccountCrypto.hash(scope.equals("password_account")?row.username():row.address());}
    private int count(Identity row,String scope) {return jdbc.queryForObject("SELECT COALESCE(sum(attempt_count),0)::int FROM auth.rate_limits WHERE scope=? AND subject_hash=?",Integer.class,scope,hash(row,scope));}
    private void seed(Identity row,String scope,int count) {
        int seconds=scope.equals("password_account")?900:600;
        jdbc.update("""
            INSERT INTO auth.rate_limits(scope,subject_hash,window_started_at,attempt_count,blocked_until,expires_at)
            SELECT ?,?,to_timestamp(floor(extract(epoch from CURRENT_TIMESTAMP)/?)*?),?,
                   CASE WHEN ?>=? THEN to_timestamp((floor(extract(epoch from CURRENT_TIMESTAMP)/?)+1)*?) ELSE NULL END,
                   to_timestamp((floor(extract(epoch from CURRENT_TIMESTAMP)/?)+1)*?)
            """,scope,hash(row,scope),seconds,seconds,count,count,scope.equals("password_account")?5:30,seconds,seconds,seconds,seconds);
    }
    private AccountService service(AccountDatabaseCrypto database) {
        var properties=new AccountProperties();return new AccountService(store,new AccountCrypto(properties,new ObjectMapper()),new PasswordTasks(database),limits,properties,new AccountBrowser(properties),database);
    }
    @Test void eightWrongRequestsForOneAccountPermitOnlyFiveActualPasswordComparisons() throws Exception {
        var row=identity();String password="parallel fixture "+UUID.randomUUID();account(row,new AccountDatabaseCrypto(source).encode(password));
        var entered=new CountDownLatch(5);AtomicInteger compared=new AtomicInteger();
        var observed=new AccountDatabaseCrypto(source) {@Override public boolean matches(String value,String encoded) {
            compared.incrementAndGet();entered.countDown();try{assertTrue(entered.await(8,TimeUnit.SECONDS));}catch(InterruptedException e){Thread.currentThread().interrupt();throw new AssertionError("等待被中断");}
            return super.matches(value,encoded);
        }};
        var service=service(observed);var callers=Executors.newFixedThreadPool(8);var barrier=new CyclicBarrier(8);AtomicInteger wrong=new AtomicInteger(),denied=new AtomicInteger();
        try {var tasks=new ArrayList<Future<?>>();for(int i=0;i<8;i++)tasks.add(callers.submit(()->{
            try{barrier.await(8,TimeUnit.SECONDS);service.login(row.username(),"incorrect fixture",row.address());throw new AssertionError("错误密码不能创建流程");}
            catch(ApiException e){if(e.getStatus().value()==401)wrong.incrementAndGet();else if(e.getStatus().value()==429)denied.incrementAndGet();else throw new AssertionError("不应出现其他HTTP状态");}
            catch(Exception e){throw new AssertionError(e.getClass().getSimpleName());}
        }));for(var task:tasks)task.get(25,TimeUnit.SECONDS);
        } finally {callers.shutdownNow();}
        assertEquals(5,compared.get());assertEquals(5,wrong.get());assertEquals(3,denied.get());assertEquals(5,count(row,"password_account"));assertEquals(5,count(row,"password_ip"));
    }
    @Test void eightDifferentIdentitiesCanComparePasswordsInParallelAndSuccessRefundsEachBudget() throws Exception {
        String password="parallel fixture "+UUID.randomUUID();String encoded=new AccountDatabaseCrypto(source).encode(password);var rows=new ArrayList<Identity>();
        for(int i=0;i<8;i++){var row=identity();account(row,encoded);rows.add(row);}
        var entered=new CountDownLatch(8);AtomicInteger active=new AtomicInteger(),maximum=new AtomicInteger();
        var observed=new AccountDatabaseCrypto(source) {@Override public boolean matches(String value,String hash) {
            int count=active.incrementAndGet();maximum.accumulateAndGet(count,Math::max);entered.countDown();
            try{assertTrue(entered.await(8,TimeUnit.SECONDS));return super.matches(value,hash);}
            catch(InterruptedException e){Thread.currentThread().interrupt();throw new AssertionError("等待被中断");}finally{active.decrementAndGet();}
        }};
        var service=service(observed);var callers=Executors.newFixedThreadPool(8);
        try{var tasks=new ArrayList<Future<?>>();for(var row:rows)tasks.add(callers.submit(()->{var issued=service.login(row.username(),password,row.address());assertFalse(issued.session());}));for(var task:tasks)task.get(25,TimeUnit.SECONDS);}
        finally{callers.shutdownNow();}
        assertEquals(8,maximum.get());for(var row:rows){assertEquals(0,count(row,"password_account"));assertEquals(0,count(row,"password_ip"));}
    }
    @Test void ipExhaustionRollsBackTheAccountPartOfACombinedReservation() {
        var row=identity();seed(row,"password_ip",30);assertEquals(429,assertThrows(ApiException.class,()->limits.reservePasswordAttempt(row.username(),row.address())).getStatus().value());
        assertEquals(0,count(row,"password_account"));assertEquals(30,count(row,"password_ip"));
    }
    @Test void successAtTheThresholdClearsBlockingAndDuplicateCloseCannotRefundTwice() {
        var row=identity();seed(row,"password_account",4);var attempt=limits.reservePasswordAttempt(row.username(),row.address());assertEquals(5,count(row,"password_account"));
        assertEquals(429,assertThrows(ApiException.class,()->limits.reservePasswordAttempt(row.username(),row.address())).getStatus().value());attempt.close();attempt.close();
        assertEquals(4,count(row,"password_account"));assertEquals(0,count(row,"password_ip"));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM auth.rate_limits WHERE scope='password_account' AND subject_hash=? AND blocked_until IS NOT NULL",Integer.class,hash(row,"password_account")));
        try(var another=limits.reservePasswordAttempt(row.username(),row.address())){assertEquals(5,count(row,"password_account"));}
        assertEquals(4,count(row,"password_account"));
    }
    @Test void closingOldAttemptCannotDeductFromTheNextWindow() {
        var row=identity();var attempt=limits.reservePasswordAttempt(row.username(),row.address());
        for(String scope:List.of("password_account","password_ip")) {
            Timestamp original=jdbc.queryForObject("SELECT window_started_at FROM auth.rate_limits WHERE scope=? AND subject_hash=?",Timestamp.class,scope,hash(row,scope));
            int seconds=scope.equals("password_account")?900:600;Timestamp next=Timestamp.from(original.toInstant().plusSeconds(seconds));
            jdbc.update("DELETE FROM auth.rate_limits WHERE scope=? AND subject_hash=?",scope,hash(row,scope));
            jdbc.update("INSERT INTO auth.rate_limits(scope,subject_hash,window_started_at,attempt_count,expires_at) VALUES (?,?,?,3,?)",scope,hash(row,scope),next,Timestamp.from(next.toInstant().plusSeconds(seconds)));
        }
        attempt.close();assertEquals(3,count(row,"password_account"));assertEquals(3,count(row,"password_ip"));
    }
    @AfterEach void cleanup() {
        if(jdbc==null)return;
        for(var row:identities) {
            for(UUID flow:jdbc.queryForList("SELECT id FROM auth.flows WHERE account_id=?",UUID.class,row.id()))jdbc.update("DELETE FROM auth.rate_limits WHERE scope='totp_flow' AND subject_hash=?",AccountCrypto.hash(flow.toString()));
            jdbc.update("DELETE FROM auth.security_events WHERE account_id=?",row.id());jdbc.update("DELETE FROM auth.accounts WHERE id=? AND username=?",row.id(),row.username());
            jdbc.update("DELETE FROM auth.rate_limits WHERE scope='password_account' AND subject_hash=?",hash(row,"password_account"));jdbc.update("DELETE FROM auth.rate_limits WHERE scope='password_ip' AND subject_hash=?",hash(row,"password_ip"));
        }
    }
}
