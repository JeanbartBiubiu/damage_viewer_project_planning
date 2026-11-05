package xyz.game.datamanage.support.account;

import java.net.InetAddress;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.Executor;
import javax.sql.DataSource;
import org.apache.commons.codec.binary.Base32;
import org.postgresql.PGConnection;
import org.postgresql.jdbc.PreferQueryMode;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Component;

/** 同一数据库连接先验证保护条件再绑定密码；不经会打印参数的通用查询助手。 */
@Component
public class AccountDatabaseCrypto {
    private static final int QUERY_SECONDS=5, NETWORK_MILLIS=10_000;
    private static final Executor DIRECT=Runnable::run;
    // 固定成本的非账号校验材料；无论比较结果如何，都不能作为未知账号登录成功。
    static final String DUMMY_HASH="$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
    private final DataSource source;
    public AccountDatabaseCrypto(DataSource source) { this.source=source; }
    public record Tokens(String token,String csrf) {
        @Override public String toString() { return "Tokens[redacted]"; }
    }
    static boolean supported(String encoded) { return encoded!=null && encoded.matches("\\$2a\\$12\\$[./A-Za-z0-9]{53}"); }
    private interface Query<T> { T run(Connection connection) throws Exception; }
    private <T> T protectedQuery(Query<T> query) {
        Connection connection=null;
        Integer previousTimeout=null;
        try {
            for(String logger:List.of("org.postgresql.core.v3.QueryExecutorImpl","org.postgresql.jdbc.PgPreparedStatement")) {
                if(java.util.logging.Logger.getLogger(logger).isLoggable(java.util.logging.Level.FINEST)
                    || org.slf4j.LoggerFactory.getLogger(logger).isTraceEnabled()) throw AccountErrors.unavailable();
            }
            // 复用事务绑定连接，避免在账号锁内再等另一条连接而耗尽连接池。
            connection=DataSourceUtils.getConnection(source);
            previousTimeout=connection.getNetworkTimeout();
            connection.setNetworkTimeout(DIRECT,previousTimeout>0?Math.min(previousTimeout,NETWORK_MILLIS):NETWORK_MILLIS);
            PGConnection pg=connection.unwrap(PGConnection.class);
            PreferQueryMode mode=pg==null?null:pg.getPreferQueryMode();
            if(mode==null || mode==PreferQueryMode.SIMPLE) throw AccountErrors.unavailable();
            verifyConnection(connection);
            return query.run(connection);
        } catch (Exception failure) {
            // 不附带原异常、参数、查询正文或驱动错误细节。
            throw AccountErrors.unavailable();
        } finally {
            if(connection!=null) {
                try { if(previousTimeout!=null) connection.setNetworkTimeout(DIRECT,previousTimeout); }
                catch (Exception failure) { throw AccountErrors.unavailable(); }
                finally { DataSourceUtils.releaseConnection(connection,source); }
            }
        }
    }
    private void verifyConnection(Connection connection) throws Exception {
        try (Statement statement=connection.createStatement()) {
            statement.setQueryTimeout(QUERY_SECONDS);
            try (ResultSet rows=statement.executeQuery("""
                SELECT current_setting('log_parameter_max_length'),
                       current_setting('log_parameter_max_length_on_error'),
                       current_setting('pgaudit.log_parameter',true),
                       host(inet_client_addr()),host(inet_server_addr()),
                       COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false),
                       current_setting('server_encoding'),current_setting('client_encoding')
                """)) {
                if(!rows.next() || !"0".equals(rows.getString(1)) || !"0".equals(rows.getString(2))) throw AccountErrors.unavailable();
                String audit=rows.getString(3);
                if(audit!=null && !List.of("off","false","0").contains(audit.toLowerCase(java.util.Locale.ROOT))) throw AccountErrors.unavailable();
                String client=rows.getString(4),server=rows.getString(5);
                boolean local=(client==null && server==null) || (loopback(client) && loopback(server));
                if(!local && !rows.getBoolean(6)) throw AccountErrors.unavailable();
                if(!"UTF8".equals(rows.getString(7)) || !"UTF8".equals(rows.getString(8))) throw AccountErrors.unavailable();
                if(rows.next()) throw AccountErrors.unavailable();
            }
        }
    }
    private boolean loopback(String address) throws Exception {
        return address!=null && address.matches("[0-9a-fA-F:.]+") && InetAddress.getByName(address).isLoopbackAddress();
    }
    private PreparedStatement prepare(Connection connection,String sql) throws Exception {
        PreparedStatement statement=connection.prepareStatement(sql);
        try { statement.setQueryTimeout(QUERY_SECONDS);return statement; }
        catch(Exception failure) { try { statement.close(); } catch(Exception ignored) {} throw failure; }
    }
    public String encode(String password) {
        PasswordTasks.validate(password,null);
        return protectedQuery(connection-> {
            try (PreparedStatement statement=prepare(connection,"SELECT public.crypt(?,public.gen_salt('bf',12))")) {
                statement.setString(1,password);
                try(ResultSet rows=statement.executeQuery()) {
                    if(!rows.next()) throw AccountErrors.unavailable();String encoded=rows.getString(1);
                    if(!supported(encoded) || rows.next()) throw AccountErrors.unavailable();return encoded;
                }
            }
        });
    }
    public boolean matches(String password,String encoded) {
        PasswordTasks.validateInput(password);
        boolean supported=supported(encoded);String candidate=supported?encoded:DUMMY_HASH;
        boolean matched=protectedQuery(connection-> {
            try(PreparedStatement statement=prepare(connection,"SELECT public.crypt(?,?)=?")) {
                statement.setString(1,password);statement.setString(2,candidate);statement.setString(3,candidate);
                try(ResultSet rows=statement.executeQuery()) {
                    if(!rows.next()) throw AccountErrors.unavailable();boolean value=rows.getBoolean(1);
                    if(rows.wasNull() || rows.next()) throw AccountErrors.unavailable();return value;
                }
            }
        });
        return supported && matched;
    }
    private byte[] bytes(ResultSet rows,int column,int length) throws Exception {
        byte[] value=rows.getBytes(column);if(value==null || value.length!=length) throw AccountErrors.unavailable();return value;
    }
    public Tokens tokens() {
        return protectedQuery(connection-> {
            try(PreparedStatement statement=prepare(connection,"SELECT public.gen_random_bytes(32),public.gen_random_bytes(32)");ResultSet rows=statement.executeQuery()) {
                if(!rows.next()) throw AccountErrors.unavailable();byte[] token=bytes(rows,1,32),csrf=bytes(rows,2,32);
                if(MessageDigest.isEqual(token,csrf) || rows.next()) throw AccountErrors.unavailable();return new Tokens(AccountCrypto.b64(token),AccountCrypto.b64(csrf));
            }
        });
    }
    public String totpSecret() {
        return protectedQuery(connection-> {
            try(PreparedStatement statement=prepare(connection,"SELECT public.gen_random_bytes(20)");ResultSet rows=statement.executeQuery()) {
                if(!rows.next()) throw AccountErrors.unavailable();String secret=new Base32().encodeToString(bytes(rows,1,20));
                if(rows.next()) throw AccountErrors.unavailable();return secret;
            }
        });
    }
    public List<String> recoveryCodes() {
        return protectedQuery(connection-> {
            List<String> codes=new ArrayList<>();
            try(PreparedStatement statement=prepare(connection,"SELECT public.gen_random_bytes(16) FROM generate_series(1,10)");ResultSet rows=statement.executeQuery()) {
                while(rows.next()) {if(codes.size()>=10) throw AccountErrors.unavailable();codes.add(AccountCrypto.b64(bytes(rows,1,16)));}
            }
            if(codes.size()!=10 || new HashSet<>(codes).size()!=10) throw AccountErrors.unavailable();return List.copyOf(codes);
        });
    }
}
