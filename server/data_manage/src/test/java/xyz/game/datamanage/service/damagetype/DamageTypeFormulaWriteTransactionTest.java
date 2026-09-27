package xyz.game.datamanage.service.damagetype;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.SmartTransactionObject;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.damagetype.DamageTypeMapper;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaReplaceRequest;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaRow;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

class DamageTypeFormulaWriteTransactionTest {

    private static final OffsetDateTime UPDATED = OffsetDateTime.parse("2026-09-27T08:00:00Z");

    private AnnotationConfigApplicationContext context;
    private DamageTypeService service;
    private DamageTypeMapper mapper;
    private TestTransactionManager transactions;
    private AtomicReference<String> committed;

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigApplicationContext(Config.class);
        service = context.getBean(DamageTypeService.class);
        mapper = context.getBean(DamageTypeMapper.class);
        transactions = context.getBean(TestTransactionManager.class);
        committed = reference(context, "committed");
        AtomicReference<String> pending = reference(context, "pending");
        when(context.getBean(GamesMapper.class).countGames("lol")).thenReturn(1L);
        when(mapper.findFormulaForUpdate("lol", "physical"))
            .thenAnswer(invocation -> new DamageTypeFormulaRow("lol", "physical", committed.get(), UPDATED));
        when(mapper.updateFormula(eq("lol"), eq("physical"), anyString())).thenAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            pending.set(invocation.getArgument(2));
            return 1;
        });
        when(mapper.findFormulaById("lol", "physical")).thenAnswer(invocation ->
            new DamageTypeFormulaRow(
                "lol",
                "physical",
                pending.get() == null ? committed.get() : pending.get(),
                UPDATED
            ));
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            assertTrue(!TransactionSynchronizationManager.isCurrentTransactionReadOnly());
            return null;
        }).when(context.getBean(GameConfigurationWriteGuard.class)).begin("lol");
    }

    @AfterEach
    void close() {
        context.close();
    }

    @Test
    void successfulReplaceCommitsTheFormulaWrittenInsideTheTransaction() throws Exception {
        service.replaceFormula("lol", "physical", request(fixedFormula("1")));

        assertEquals(1, transactions.commits);
        assertEquals(0, transactions.rollbacks);
        assertTrue(committed.get().contains("\"nodeType\":\"FIXED\""));
    }

    @Test
    void validationFailureRollsBackWithoutWriting() throws Exception {
        ApiException error = assertThrows(ApiException.class,
            () -> service.replaceFormula("lol", "physical", request("[]")));

        assertEquals("400.INVALID_BODY", error.getCode());
        assertEquals(0, transactions.commits);
        assertEquals(1, transactions.rollbacks);
        assertEquals(null, committed.get());
        verify(mapper, never()).updateFormula(any(), any(), any());
    }

    @Test
    void writeFailureRollsBackAndLeavesNoCommittedFormula() throws Exception {
        when(mapper.updateFormula(eq("lol"), eq("physical"), anyString())).thenAnswer(invocation -> {
            reference(context, "pending").set(invocation.getArgument(2));
            throw new DataIntegrityViolationException("json object check");
        });

        assertThrows(DataIntegrityViolationException.class,
            () -> service.replaceFormula("lol", "physical", request(fixedFormula("2"))));

        assertEquals(0, transactions.commits);
        assertEquals(1, transactions.rollbacks);
        assertEquals(null, committed.get());
        verify(mapper, never()).findFormulaById("lol", "physical");
    }

    @SuppressWarnings("unchecked")
    private static AtomicReference<String> reference(AnnotationConfigApplicationContext context, String name) {
        return (AtomicReference<String>) context.getBean(name);
    }

    private static DamageTypeFormulaReplaceRequest request(String formula) throws Exception {
        return new DamageTypeFormulaReplaceRequest(
            new ObjectMapper().readTree("{\"formula\":" + formula + "}").get("formula")
        );
    }

    private static String fixedFormula(String number) {
        String node = "{\"nodeType\":\"FIXED\",\"value\":" + number + "}";
        return "{"
            + "\"resistanceBeforePenetration\":" + node + ","
            + "\"penetrationPercent\":" + node + ","
            + "\"penetrationFlat\":" + node + ","
            + "\"effectiveResistance\":" + node + ","
            + "\"resistanceFactor\":" + node
            + "}";
    }

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    @Import(DamageTypeService.class)
    static class Config {
        @Bean GameConfigurationWriteGuard configurationWrites() {
            return mock(GameConfigurationWriteGuard.class);
        }

        @Bean GamesMapper gamesMapper() {
            return mock(GamesMapper.class);
        }

        @Bean DamageTypeMapper damageTypeMapper() {
            return mock(DamageTypeMapper.class);
        }

        @Bean(name = "committed") AtomicReference<String> committed() {
            return new AtomicReference<>();
        }

        @Bean(name = "pending") AtomicReference<String> pending() {
            return new AtomicReference<>();
        }

        @Bean TestTransactionManager transactionManager(
            @org.springframework.beans.factory.annotation.Qualifier("pending") AtomicReference<String> pending,
            @org.springframework.beans.factory.annotation.Qualifier("committed") AtomicReference<String> committed
        ) {
            return new TestTransactionManager(pending, committed);
        }
    }

    static class TestTransactionManager extends AbstractPlatformTransactionManager {
        private final AtomicReference<String> pending;
        private final AtomicReference<String> committed;
        private final ThreadLocal<Tx> current = new ThreadLocal<>();
        int commits;
        int rollbacks;

        TestTransactionManager(AtomicReference<String> pending, AtomicReference<String> committed) {
            this.pending = pending;
            this.committed = committed;
        }

        @Override protected Object doGetTransaction() {
            return current.get() == null ? new Tx() : current.get();
        }

        @Override protected boolean isExistingTransaction(Object transaction) {
            return ((Tx) transaction).active;
        }

        @Override protected void doBegin(Object transaction, TransactionDefinition definition) {
            Tx tx = (Tx) transaction;
            tx.active = true;
            current.set(tx);
        }

        @Override protected void doCommit(DefaultTransactionStatus status) {
            commits++;
            committed.set(pending.get());
            pending.set(null);
        }

        @Override protected void doRollback(DefaultTransactionStatus status) {
            rollbacks++;
            pending.set(null);
        }

        @Override protected void doSetRollbackOnly(DefaultTransactionStatus status) {
            ((Tx) status.getTransaction()).rollback = true;
        }

        @Override protected void doCleanupAfterCompletion(Object transaction) {
            current.remove();
        }

        static class Tx implements SmartTransactionObject {
            boolean active;
            boolean rollback;

            @Override public boolean isRollbackOnly() {
                return rollback;
            }

            @Override public void flush() {
            }
        }
    }
}
