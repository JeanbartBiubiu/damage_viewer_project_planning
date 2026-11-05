package xyz.game.datamanage.support.account;

import java.sql.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.PGConnection;
import org.postgresql.jdbc.PreferQueryMode;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AccountDatabaseCryptoTest {
    private final DataSource source=mock(DataSource.class);
    private final Connection connection=mock(Connection.class);
    private final PGConnection pg=mock(PGConnection.class);
    private final Statement guard=mock(Statement.class);
    private final ResultSet policy=mock(ResultSet.class);
    private final PreparedStatement query=mock(PreparedStatement.class);
    private final ResultSet result=mock(ResultSet.class);
    private final AtomicBoolean checked=new AtomicBoolean();
    private final Map<Integer,String> parameters=new HashMap<>();
    private AccountDatabaseCrypto database;
    @BeforeEach void setup() throws Exception {
        when(source.getConnection()).thenReturn(connection);when(connection.unwrap(PGConnection.class)).thenReturn(pg);
        when(pg.getPreferQueryMode()).thenReturn(PreferQueryMode.EXTENDED);when(connection.getNetworkTimeout()).thenReturn(20_000);
        when(connection.createStatement()).thenReturn(guard);when(guard.executeQuery(anyString())).thenAnswer(i->{
            checked.set(false);AtomicInteger cursor=new AtomicInteger();
            when(policy.next()).thenAnswer(n->{boolean first=cursor.getAndIncrement()==0;if(!first)checked.set(true);return first;});return policy;
        });
        when(policy.getString(1)).thenReturn("0");when(policy.getString(2)).thenReturn("0");
        when(policy.getString(4)).thenReturn("127.0.0.1");when(policy.getString(5)).thenReturn("127.0.0.1");
        when(policy.getString(7)).thenReturn("UTF8");when(policy.getString(8)).thenReturn("UTF8");
        when(connection.prepareStatement(anyString())).thenReturn(query);when(query.executeQuery()).thenReturn(result);
        doAnswer(i->{assertTrue(checked.get(),"绑定前必须完成同连接保护检查");parameters.put(i.getArgument(0),i.getArgument(1));return null;}).when(query).setString(anyInt(),anyString());
        database=new AccountDatabaseCrypto(source);
    }
    private void oneRow() throws Exception {when(result.next()).thenReturn(true,false);}
    private void unavailable(Runnable action) {
        ApiException failure=assertThrows(ApiException.class,action::run);assertEquals(503,failure.getStatus().value());assertNull(failure.getCause());
    }
    @Test void constructionDoesNotContactDatabaseOrRequireExtension() {
        reset(source);new AccountDatabaseCrypto(source);new PasswordTasks(database).close();verifyNoInteractions(source);
    }
    @Test void passwordIsBoundOnlyAfterGuardsOnSameConnectionWithTimeoutRestored() throws Exception {
        oneRow();when(result.getString(1)).thenReturn(AccountDatabaseCrypto.DUMMY_HASH);
        String password="  fixture password  ";assertTrue(AccountDatabaseCrypto.supported(database.encode(password)));
        assertTrue(password.equals(parameters.get(1)));
        var order=inOrder(pg,guard,query);order.verify(pg).getPreferQueryMode();order.verify(guard).executeQuery(anyString());order.verify(query).setString(eq(1),anyString());
        verify(connection).setNetworkTimeout(any(),eq(10_000));verify(connection).setNetworkTimeout(any(),eq(20_000));verify(query).setQueryTimeout(5);verify(guard).setQueryTimeout(5);
        verify(connection,never()).commit();verify(connection,never()).rollback();verify(connection,never()).setAutoCommit(anyBoolean());
    }
    @Test void unknownAndUnsupportedHashesStillRunOneFixedCostCheckButCannotSucceed() throws Exception {
        when(result.next()).thenAnswer(new org.mockito.stubbing.Answer<Boolean>() {int count;public Boolean answer(org.mockito.invocation.InvocationOnMock i){return count++%2==0;}});
        when(result.getBoolean(1)).thenReturn(true);
        for(String old:new String[]{null,"$argon2id$unsupported","$2b$12$unsupported",AccountDatabaseCrypto.DUMMY_HASH.replace("$12$","$10$")}) {
            assertFalse(database.matches("fixture password",old));
            assertTrue(AccountDatabaseCrypto.DUMMY_HASH.equals(parameters.get(2)) && parameters.get(2).equals(parameters.get(3)));
        }
        verify(query,times(4)).executeQuery();
        assertTrue(database.matches("fixture password",AccountDatabaseCrypto.DUMMY_HASH));
    }
    @Test void simpleProtocolNeverBindsOrExecutesPassword() throws Exception {
        when(pg.getPreferQueryMode()).thenReturn(PreferQueryMode.SIMPLE);unavailable(()->database.encode("fixture password"));
        verify(connection,never()).createStatement();verify(connection,never()).prepareStatement(anyString());assertTrue(parameters.isEmpty());
        verify(connection).setNetworkTimeout(any(),eq(20_000));
    }
    @Test void driverBindTraceLoggingFailsBeforeAcquiringConnection() throws Exception {
        var logger=java.util.logging.Logger.getLogger("org.postgresql.core.v3.QueryExecutorImpl");var old=logger.getLevel();
        try {logger.setLevel(java.util.logging.Level.FINEST);unavailable(()->database.encode("fixture password"));verify(source,never()).getConnection();}
        finally {logger.setLevel(old);}
    }
    @Test void parameterOrAuditLoggingFailsClosedBeforeAnySecretBinding() throws Exception {
        when(policy.getString(1)).thenReturn("-1");unavailable(()->database.matches("fixture password",null));verify(connection,never()).prepareStatement(anyString());
        when(policy.getString(1)).thenReturn("0");when(policy.getString(2)).thenReturn("100");unavailable(()->database.encode("fixture password"));
        when(policy.getString(2)).thenReturn("0");when(policy.getString(3)).thenReturn("on");unavailable(()->database.encode("fixture password"));assertTrue(parameters.isEmpty());
    }
    @Test void remotePlaintextIsRejectedAndRemoteTlsAllowed() throws Exception {
        when(policy.getString(4)).thenReturn("10.0.0.2");when(policy.getString(5)).thenReturn("10.0.0.3");
        unavailable(()->database.encode("fixture password"));verify(connection,never()).prepareStatement(anyString());
        when(policy.getBoolean(6)).thenReturn(true);oneRow();when(result.getString(1)).thenReturn(AccountDatabaseCrypto.DUMMY_HASH);
        assertTrue(AccountDatabaseCrypto.supported(database.encode("fixture password")));
    }
    @Test void policyQueryRemovesPostgresInetMasksAndAcceptsBothLoopbackFamiliesWithoutTls() throws Exception {
        for(String address:List.of("127.0.0.1","::1")) {
            when(policy.getString(4)).thenReturn(address);when(policy.getString(5)).thenReturn(address);
            oneRow();when(result.getString(1)).thenReturn(AccountDatabaseCrypto.DUMMY_HASH);
            assertTrue(AccountDatabaseCrypto.supported(database.encode("fixture password")));
        }
        var sql=org.mockito.ArgumentCaptor.forClass(String.class);verify(guard,times(2)).executeQuery(sql.capture());
        assertTrue(sql.getAllValues().stream().allMatch(text->text.contains("host(inet_client_addr())") && text.contains("host(inet_server_addr())")));
    }
    @Test void oneLoopbackEndpointDoesNotExemptARemoteConnectionFromTls() throws Exception {
        when(policy.getString(4)).thenReturn("127.0.0.1");when(policy.getString(5)).thenReturn("10.0.0.3");
        unavailable(()->database.encode("fixture password"));verify(connection,never()).prepareStatement(anyString());
    }
    @Test void databaseAndConnectionMustUseTheDeclaredUtf8ByteSemantics() throws Exception {
        when(policy.getString(7)).thenReturn("SQL_ASCII");unavailable(()->database.encode("fixture password"));
        when(policy.getString(7)).thenReturn("UTF8");when(policy.getString(8)).thenReturn("LATIN1");unavailable(()->database.encode("fixture password"));
        verify(connection,never()).prepareStatement(anyString());
    }
    @Test void malformedAndOverlongPasswordsNeverReachDatasourceOrTruncate() {
        reset(source);
        for(String password:List.of("a".repeat(73),"中".repeat(25),"x".repeat(12)+"\0","x".repeat(12)+"\uD800","x".repeat(12)+"\uDC00")) {
            assertEquals(400,assertThrows(ApiException.class,()->database.matches(password,null)).getStatus().value());
        }
        verifyNoInteractions(source);
    }
    @Test void sqlOrTimeoutFailuresNeverExposeOriginalExceptionOrParameters() throws Exception {
        when(query.executeQuery()).thenThrow(new SQLException("sensitive-driver-message","XX000"));
        ApiException failure=assertThrows(ApiException.class,()->database.encode("fixture password"));assertEquals(503,failure.getStatus().value());assertNull(failure.getCause());assertFalse(failure.getMessage().contains("sensitive-driver-message"));
        verify(connection).setNetworkTimeout(any(),eq(20_000));
    }
    @Test void tokensAndSeedValidateExactLengthsAndDoNotUseJavaRandomness() throws Exception {
        oneRow();byte[] first=new byte[32],second=new byte[32];Arrays.fill(first,(byte)1);Arrays.fill(second,(byte)2);
        when(result.getBytes(1)).thenReturn(first);when(result.getBytes(2)).thenReturn(second);
        var tokens=database.tokens();assertEquals(43,tokens.token().length());assertEquals(43,tokens.csrf().length());assertFalse(tokens.token().equals(tokens.csrf()));
        oneRow();when(result.getBytes(1)).thenReturn(new byte[20]);assertTrue(database.totpSecret().matches("[A-Z2-7]{32}"));
        oneRow();when(result.getBytes(1)).thenReturn(new byte[19]);unavailable(database::totpSecret);
    }
    @Test void recoveryBatchUsesExactlyOneQueryAndRejectsDuplicatesOrWrongBatchSize() throws Exception {
        AtomicInteger cursor=new AtomicInteger();when(result.next()).thenAnswer(i->cursor.incrementAndGet()<=10);
        when(result.getBytes(1)).thenAnswer(i->{byte[] code=new byte[16];Arrays.fill(code,(byte)cursor.get());return code;});
        var codes=database.recoveryCodes();assertEquals(10,new HashSet<>(codes).size());assertTrue(codes.stream().allMatch(code->code.matches("[A-Za-z0-9_-]{22}")));verify(query).executeQuery();
        cursor.set(0);when(result.getBytes(1)).thenReturn(new byte[16]);unavailable(database::recoveryCodes);
    }
    @Test void transactionBoundConnectionIsReusedAndNeverCommittedRolledBackOrClosed() throws Exception {
        var holder=new ConnectionHolder(connection);TransactionSynchronizationManager.bindResource(source,holder);
        try {
            oneRow();when(result.getBytes(1)).thenReturn(new byte[20]);assertEquals(32,database.totpSecret().length());
            verify(source,never()).getConnection();verify(connection,never()).close();verify(connection,never()).commit();verify(connection,never()).rollback();verify(connection).setNetworkTimeout(any(),eq(20_000));
        } finally {TransactionSynchronizationManager.unbindResource(source);}
    }
}
