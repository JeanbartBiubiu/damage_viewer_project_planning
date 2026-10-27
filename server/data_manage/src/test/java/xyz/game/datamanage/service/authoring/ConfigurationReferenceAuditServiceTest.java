package xyz.game.datamanage.service.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditReader;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor.Input;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor.ReadCounts;
import xyz.game.datamanage.support.error.ApiException;

class ConfigurationReferenceAuditServiceTest {
    private final GamesMapper games = mock(GamesMapper.class);
    private final ConfigurationReferenceAuditReader reader = mock(ConfigurationReferenceAuditReader.class);
    private final ConfigurationReferenceAuditService service = new ConfigurationReferenceAuditService(games, reader);

    @Test
    void gameCheckAndAllReaderWorkUseOneRepeatableReadReadonlyTransaction() {
        var transactions = new RecordingTransactions();
        ProxyFactory factory = new ProxyFactory(service);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(transactions, new AnnotationTransactionAttributeSource()));
        when(games.countGames("lol")).thenAnswer(invocation -> { assertReadonly(); return 1L; });
        when(reader.read("lol")).thenAnswer(invocation -> {
            assertReadonly();
            return new Input("lol", new ReadCounts(0, 0, 0, 0, 0, 0), List.of(), List.of(), Set.of(), true);
        });
        var result = ((ConfigurationReferenceAuditService) factory.getProxy()).audit("lol");
        assertTrue(result.healthy());
        assertEquals(1, transactions.commits);
        verify(games).countGames("lol");
        verify(reader).read("lol");
        verifyNoMoreInteractions(games, reader);
    }

    @Test
    void nonexistentGameKeeps404AndDoesNotReadConfiguration() {
        when(games.countGames("missing")).thenReturn(0L);
        ApiException error = assertThrows(ApiException.class, () -> service.audit("missing"));
        assertEquals("404.GAME_NOT_FOUND", error.getCode());
        assertEquals("missing", error.getDetails().get("gameId"));
        verifyNoInteractions(reader);
    }

    @Test
    void readerFailureIsNotReplacedWithHealthyReport() {
        when(games.countGames("lol")).thenReturn(1L);
        when(reader.read("lol")).thenThrow(new IllegalStateException("test reader failure"));
        assertThrows(IllegalStateException.class, () -> service.audit("lol"));
    }

    private static void assertReadonly() {
        assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
        assertTrue(TransactionSynchronizationManager.isCurrentTransactionReadOnly());
        assertEquals(TransactionDefinition.ISOLATION_REPEATABLE_READ,
            TransactionSynchronizationManager.getCurrentTransactionIsolationLevel());
    }

    static class RecordingTransactions extends AbstractPlatformTransactionManager {
        int commits;
        @Override protected Object doGetTransaction() { return new Object(); }
        @Override protected void doBegin(Object transaction, TransactionDefinition definition) {
            assertTrue(definition.isReadOnly());
            assertEquals(TransactionDefinition.ISOLATION_REPEATABLE_READ, definition.getIsolationLevel());
        }
        @Override protected void doCommit(DefaultTransactionStatus status) { commits++; }
        @Override protected void doRollback(DefaultTransactionStatus status) { fail("Unexpected rollback"); }
    }
}
