package xyz.game.datamanage.support.account;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;

/** 只显式运行于本任务新隔离库，不选择应用默认数据源或旧发布库。 */
class AccountDatabaseCryptoIT {
    private DriverManagerDataSource source;
    private JdbcTemplate jdbc;
    private AccountDatabaseCrypto database;
    private String required(String name) {String value=System.getenv(name);if(value==null || value.isEmpty()) throw new IllegalStateException("缺少隔离测试配置："+name);return value;}
    @BeforeEach void setup() {
        if(!"isolated-account-tests".equals(System.getenv("ACCOUNT_IT_ALLOW_MUTATION"))) throw new IllegalStateException("需要显式隔离测试授权");
        String name=required("ACCOUNT_IT_DATABASE_NAME"),url=required("ACCOUNT_IT_JDBC_URL");
        if(!name.matches("dv_auth_verify_20261104_pg_20261105_[a-f0-9]{8}") || !url.matches(".*[/]"+java.util.regex.Pattern.quote(name)+"(?:\\?.*)?$")) throw new IllegalStateException("隔离库不在本任务范围");
        source=new DriverManagerDataSource(url,required("ACCOUNT_IT_JDBC_USERNAME"),required("ACCOUNT_IT_JDBC_PASSWORD"));jdbc=new JdbcTemplate(source);
        if(!name.equals(jdbc.queryForObject("SELECT current_database()",String.class))) throw new IllegalStateException("隔离库名称不匹配");
        database=new AccountDatabaseCrypto(source);
    }
    @Test void databaseBcryptUsesFixedVersionCostAndIndependentSalts() {
        var tasks=new PasswordTasks(database);
        String value="  fixture 密码  ",one=tasks.encode(value,"fixture"),two=tasks.encode(value,"fixture");
        assertTrue(one.startsWith("$2a$10$") && one.length()==60);assertTrue(two.startsWith("$2a$10$") && two.length()==60);assertFalse(one.equals(two));
        assertTrue(tasks.matches(value,one));assertFalse(tasks.matches(value.strip(),one));assertFalse(tasks.matches("incorrect fixture",one));
        assertFalse(tasks.matches(value,null));assertFalse(tasks.matches(value,"$argon2id$unsupported"));
        assertFalse(tasks.matches(value,one.replace("$2a$10$","$2b$10$")));assertFalse(tasks.matches(value,one.replace("$10$","$11$")));
    }
    @Test void oldCostTwelveStillVerifiesWithoutAutomaticRehashing() throws Exception {
        String value="legacy fixture password";
        Class<?> query=Class.forName(AccountDatabaseCrypto.class.getName()+"$Query");
        Object fixture=java.lang.reflect.Proxy.newProxyInstance(query.getClassLoader(),new Class<?>[]{query},(proxy,method,args)->{
            if(!method.getName().equals("run")) return "LegacyFixtureQuery";
            try(var statement=((java.sql.Connection)args[0]).prepareStatement("SELECT public.crypt(?,public.gen_salt('bf',12))")) {
                statement.setQueryTimeout(5);statement.setString(1,value);
                try(var rows=statement.executeQuery()){assertTrue(rows.next());return rows.getString(1);}
            }
        });
        var guarded=AccountDatabaseCrypto.class.getDeclaredMethod("protectedQuery",query);guarded.setAccessible(true);
        String old=(String)guarded.invoke(database,fixture);
        assertTrue(old.startsWith("$2a$12$") && old.length()==60);assertTrue(database.matches(value,old));assertFalse(database.matches("incorrect fixture",old));
        assertFalse(database.matches(value,old.replace("$12$","$09$")));assertTrue(old.startsWith("$2a$12$"));
    }
    @Test void fullSeventyTwoUtf8BytesAreSignificantAndLongInputCannotBeSilentlyTruncated() {
        String ascii="Ab9!".repeat(18),unicode="😀😁😂🤣".repeat(4)+"😀😁";
        String encoded=database.encode(ascii);assertTrue(database.matches(ascii,encoded));assertFalse(database.matches(ascii.substring(0,71)+"?",encoded));
        assertThrows(RuntimeException.class,()->database.matches(ascii+"x",encoded));
        String other=database.encode(unicode);assertTrue(database.matches(unicode,other));assertThrows(RuntimeException.class,()->database.matches(unicode+"😀",other));
        assertThrows(RuntimeException.class,()->database.matches("x".repeat(12)+"\0",other));assertThrows(RuntimeException.class,()->database.matches("x".repeat(12)+"\uD800",other));
    }
    @Test void realDatabaseRandomMaterialsHaveExactEncodedShapesAndIndependentBatches() {
        Set<String> tokens=new HashSet<>(),seeds=new HashSet<>(),codes=new HashSet<>();
        for(int i=0;i<8;i++) {
            var pair=database.tokens();assertTrue(pair.token().matches("[A-Za-z0-9_-]{43}"));assertTrue(pair.csrf().matches("[A-Za-z0-9_-]{43}"));
            assertTrue(tokens.add(pair.token()));assertTrue(tokens.add(pair.csrf()));String seed=database.totpSecret();assertTrue(seed.matches("[A-Z2-7]{32}"));assertTrue(seeds.add(seed));
            var batch=database.recoveryCodes();assertEquals(10,batch.size());for(String code:batch){assertTrue(code.matches("[A-Za-z0-9_-]{22}"));assertTrue(codes.add(code));}
        }
    }
    @Test void randomGenerationReusesTransactionConnectionAndDoesNotCommitCallerWrites() {
        UUID id=UUID.randomUUID();String name="dbit_"+id.toString().replace("-","").substring(0,20);
        var tx=new TransactionTemplate(new DataSourceTransactionManager(source));
        try {
            assertThrows(DeliberateRollback.class,()->tx.execute(status->{
                jdbc.update("INSERT INTO auth.accounts(id,username,password_hash) VALUES (?,?,?)",id,name,AccountDatabaseCrypto.DUMMY_HASH);
                var connection=DataSourceUtils.getConnection(source);
                try {int before=connection.getNetworkTimeout();long transaction=jdbc.queryForObject("SELECT txid_current()",Long.class);
                    database.tokens();database.totpSecret();database.recoveryCodes();assertEquals(before,connection.getNetworkTimeout());assertFalse(connection.getAutoCommit());assertEquals(transaction,jdbc.queryForObject("SELECT txid_current()",Long.class));
                } catch(java.sql.SQLException failure) {throw new AssertionError("连接状态核对失败");}
                finally {DataSourceUtils.releaseConnection(connection,source);}
                throw new DeliberateRollback();
            }));
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM auth.accounts WHERE id=?",Integer.class,id));
        } finally {jdbc.update("DELETE FROM auth.accounts WHERE id=? AND username=?",id,name);}
    }
    private static class DeliberateRollback extends RuntimeException {}
}
