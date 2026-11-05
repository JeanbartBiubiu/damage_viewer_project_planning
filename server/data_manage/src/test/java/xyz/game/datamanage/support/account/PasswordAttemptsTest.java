package xyz.game.datamanage.support.account;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PasswordAttemptsTest {
    private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    private final PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
    private final TransactionStatus status=mock(TransactionStatus.class);
    private AccountRateLimits limits;
    private final Timestamp accountWindow=Timestamp.from(Instant.parse("2026-11-05T00:00:00Z")),ipWindow=Timestamp.from(Instant.parse("2026-11-05T00:10:00Z"));
    @BeforeEach void setup() {
        when(manager.getTransaction(any())).thenReturn(status);limits=new AccountRateLimits(new AccountStore(jdbc,manager));
        when(jdbc.queryForList(contains("RETURNING window_started_at"),eq(Timestamp.class),any(Object[].class))).thenReturn(List.of(accountWindow),List.of(ipWindow));
    }
    @Test void ipDenialRollsBackTheAlreadyReservedAccountInTheJointTransaction() {
        when(jdbc.queryForList(contains("RETURNING window_started_at"),eq(Timestamp.class),any(Object[].class))).thenReturn(List.of(accountWindow),List.of());
        when(jdbc.queryForObject(anyString(),eq(Long.class),any(Object[].class))).thenReturn(21L);
        var failure=assertThrows(ApiException.class,()->limits.reservePasswordAttempt("fixture_author","127.0.0.2"));assertEquals(429,failure.getStatus().value());
        verify(manager).rollback(status);verify(manager,never()).commit(any());
    }
    @Test void accountThenIpReservationAndRefundUseTheExactReturnedOriginalWindows() {
        var attempt=limits.reservePasswordAttempt("fixture_author","127.0.0.2");attempt.close();attempt.close();
        var calls=org.mockito.Mockito.mockingDetails(jdbc).getInvocations().stream().filter(i->i.getMethod().getName().equals("queryForList")).toList();
        assertEquals("password_account",calls.get(0).getArgument(2));assertEquals("password_ip",calls.get(1).getArgument(2));
        verify(jdbc).update(contains("window_started_at=?"),eq(5),eq("password_account"),any(byte[].class),eq(accountWindow));
        verify(jdbc).update(contains("window_started_at=?"),eq(30),eq("password_ip"),any(byte[].class),eq(ipWindow));
        verify(manager,times(2)).commit(status);verify(jdbc,times(2)).update(contains("blocked_until=CASE WHEN attempt_count-1<? THEN NULL"),any(Object[].class));
    }
    @Test void wrongProofKeepsOnlyOneReservationEvenWhenClosedRepeatedly() {
        var attempt=limits.reservePasswordAttempt("fixture_author","127.0.0.2");attempt.retainFailure();attempt.retainFailure();attempt.close();attempt.close();
        verify(jdbc,never()).update(anyString(),any(Object[].class));verify(manager).commit(status);
    }
    @Test void refundFailureCannotMakeASecondCloseDecrementAnotherAttempt() {
        var attempt=limits.reservePasswordAttempt("fixture_author","127.0.0.2");when(jdbc.update(anyString(),any(Object[].class))).thenThrow(new IllegalStateException("fixture database unavailable"));
        var failure=assertThrows(ApiException.class,attempt::close);assertEquals(503,failure.getStatus().value());assertNull(failure.getCause());assertDoesNotThrow(attempt::close);verify(jdbc).update(anyString(),any(Object[].class));verify(manager).rollback(status);
    }
}
