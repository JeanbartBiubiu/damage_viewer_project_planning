package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import xyz.game.datamanage.mapper.EditLogMapper;
import xyz.game.datamanage.service.PostgresWriteStore;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AccountControllerTestConfig;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AccountGameWriteGuardTest {
    private AnnotationConfigApplicationContext context;
    private PostgresWriteStore writes;
    private AccountSessions sessions;
    private EditLogMapper mapper;
    private Transactions transactions;
    @BeforeEach void setup() {
        context=new AnnotationConfigApplicationContext(Config.class);writes=context.getBean(PostgresWriteStore.class);
        sessions=context.getBean(AccountSessions.class);mapper=context.getBean(EditLogMapper.class);transactions=context.getBean(Transactions.class);
        var request=new MockHttpServletRequest("PUT","/api/admin/games/lol/attributes");
        request.setAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR,AccountControllerTestConfig.editor());
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }
    @AfterEach void cleanup() { RequestContextHolder.resetRequestAttributes();context.close(); }
    @Test void authorizationLockRunsInsideTheRealTransactionBeforeBusinessWrite() {
        List<String> order=new ArrayList<>();
        doAnswer(i->{assertTrue(TransactionSynchronizationManager.isActualTransactionActive());order.add("account");return null;}).when(sessions).lockEditor(any());
        when(mapper.insertEditLog(any(),anyString(),anyString())).thenAnswer(i->{assertEquals(List.of("account"),order);order.add("write");return 1;});
        var auth=AccountControllerTestConfig.editor();writes.recordEditLog(auth.accountId(),auth.username(),"PUT","/api/admin/games/lol/attributes",null,200);
        assertEquals(List.of("account","write"),order);assertEquals(1,transactions.commits);assertEquals(0,transactions.rollbacks);
    }
    @Test void concurrentRevocationDenialRollsBackAndPreventsEveryBusinessStatement() {
        doThrow(AccountErrors.invalid()).when(sessions).lockEditor(any());
        var auth=AccountControllerTestConfig.editor();assertThrows(RuntimeException.class,()->writes.recordEditLog(auth.accountId(),auth.username(),"PUT","/api/admin/games/lol/attributes",null,200));
        verifyNoInteractions(mapper);assertEquals(0,transactions.commits);assertEquals(1,transactions.rollbacks);
    }
    @Test void matrixUriCannotBypassTransactionAuthorizationGuard() {
        ((ServletRequestAttributes)RequestContextHolder.currentRequestAttributes()).getRequest().setAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR,null);
        var request=new MockHttpServletRequest("PUT","/api/admin;probe/games/lol/attributes");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        var auth=AccountControllerTestConfig.editor();assertThrows(RuntimeException.class,()->writes.recordEditLog(auth.accountId(),auth.username(),"PUT",request.getRequestURI(),null,200));
        verifyNoInteractions(mapper);assertEquals(1,transactions.rollbacks);
    }
    @Configuration @EnableAspectJAutoProxy @Import({AccountGameWriteGuard.class,PostgresWriteStore.class})
    static class Config {
        @Bean AccountSessions accountSessions() { return mock(AccountSessions.class); }
        @Bean EditLogMapper mapper() { return mock(EditLogMapper.class); }
        @Bean ObjectMapper json() { return new ObjectMapper(); }
        @Bean Transactions transactions() { return new Transactions(); }
    }
    static class Transactions extends AbstractPlatformTransactionManager {
        int commits,rollbacks;
        @Override protected Object doGetTransaction() { return new Object(); }
        @Override protected void doBegin(Object transaction,TransactionDefinition definition) {}
        @Override protected void doCommit(DefaultTransactionStatus status) { commits++; }
        @Override protected void doRollback(DefaultTransactionStatus status) { rollbacks++; }
    }
}
