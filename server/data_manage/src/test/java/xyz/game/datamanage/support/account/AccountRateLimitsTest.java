package xyz.game.datamanage.support.account;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AccountRateLimitsTest {
    @Test void failedAttemptsCommitInAnIndependentTransactionAndReturnRetryAfter() {
        var jdbc=mock(JdbcTemplate.class);var manager=mock(PlatformTransactionManager.class);var status=mock(TransactionStatus.class);
        when(manager.getTransaction(any())).thenReturn(status);var limits=new AccountRateLimits(new AccountStore(jdbc,manager));
        limits.fail("password_account","fixture_author");
        var definition=ArgumentCaptor.forClass(TransactionDefinition.class);verify(manager).getTransaction(definition.capture());
        assertEquals(TransactionDefinition.PROPAGATION_REQUIRES_NEW,definition.getValue().getPropagationBehavior());verify(manager).commit(status);
        when(jdbc.queryForObject(anyString(),eq(Long.class),any(Object[].class))).thenReturn(27L);
        var ex=assertThrows(xyz.game.datamanage.support.error.ApiException.class,()->limits.check("password_account","fixture_author"));
        assertEquals(429,ex.getStatus().value());assertEquals(27L,ex.getDetails().get("retryAfter"));
    }
    @Test void fifthReservedGuessIsAllowedButSixthCannotReachTheVerifierAndReservationsCommit() {
        var jdbc=mock(JdbcTemplate.class);var manager=mock(PlatformTransactionManager.class);var status=mock(TransactionStatus.class);
        when(manager.getTransaction(any())).thenReturn(status);var limits=new AccountRateLimits(new AccountStore(jdbc,manager));
        when(jdbc.queryForList(contains("RETURNING attempt_count"),eq(Integer.class),any(Object[].class)))
            .thenReturn(java.util.List.of(5),java.util.List.of());
        when(jdbc.queryForObject(anyString(),eq(Long.class),any(Object[].class))).thenReturn(120L);
        String flow=java.util.UUID.randomUUID().toString();
        assertDoesNotThrow(()->limits.reserveTotp("totp_flow",flow));
        var ex=assertThrows(xyz.game.datamanage.support.error.ApiException.class,()->limits.reserveTotp("totp_flow",flow));
        assertEquals(429,ex.getStatus().value());assertEquals(120L,ex.getDetails().get("retryAfter"));
        verify(manager,times(2)).commit(status);verify(manager,never()).rollback(any());
    }
}
