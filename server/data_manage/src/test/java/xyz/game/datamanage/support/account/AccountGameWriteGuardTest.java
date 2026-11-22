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
import xyz.game.datamanage.support.maintenance.MaintenancePrincipal;
import xyz.game.datamanage.support.auth.AccountControllerTestConfig;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** 验证真实Spring代理的鉴权次序与失败传播；事务管理器为替身，不证明实库锁或回滚。 */
class AccountGameWriteGuardTest {
    private AnnotationConfigApplicationContext context;
    private PostgresWriteStore writes;
    private xyz.game.datamanage.support.maintenance.MaintenancePrincipals sessions;
    private EditLogMapper mapper;
    private Transactions transactions;
    @BeforeEach void setup() {
        context=new AnnotationConfigApplicationContext(Config.class);writes=context.getBean(PostgresWriteStore.class);
        sessions=context.getBean(xyz.game.datamanage.support.maintenance.MaintenancePrincipals.class);mapper=context.getBean(EditLogMapper.class);transactions=context.getBean(Transactions.class);
        var request=new MockHttpServletRequest("PUT","/api/admin/games/lol/attributes");
        request.setAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE,AccountControllerTestConfig.principal());
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }
    @AfterEach void cleanup() { RequestContextHolder.resetRequestAttributes();context.close(); }
    @Test void authorizationLockRunsInsideTransactionProxyBeforeBusinessWrite() {
        List<String> order=new ArrayList<>();
        doAnswer(i->{assertTrue(TransactionSynchronizationManager.isActualTransactionActive());order.add("account");return null;}).when(sessions).lock(any());
        when(mapper.insertEditLog(any(),anyString(),anyString())).thenAnswer(i->{assertEquals(List.of("account"),order);order.add("write");return 1;});
        var auth=AccountControllerTestConfig.principal();writes.recordEditLog(auth.principalId(),auth.displayName(),"PUT","/api/admin/games/lol/attributes",null,200);
        assertEquals(List.of("account","write"),order);assertEquals(1,transactions.commits);assertEquals(0,transactions.rollbacks);
    }
    @Test void disabledPrincipalDenialTriggersRollbackAndPreventsEveryBusinessStatement() {
        ApiException revoked=AccountErrors.invalid();doThrow(revoked).when(sessions).lock(any());
        var auth=AccountControllerTestConfig.principal();
        assertSame(revoked,assertThrows(ApiException.class,()->writes.recordEditLog(auth.principalId(),auth.displayName(),"PUT","/api/admin/games/lol/attributes",null,200)));
        verifyNoInteractions(mapper);assertEquals(0,transactions.commits);assertEquals(1,transactions.rollbacks);
    }
    @Test void matrixUriCannotBypassTransactionAuthorizationGuard() {
        ((ServletRequestAttributes)RequestContextHolder.currentRequestAttributes()).getRequest().setAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE,null);
        var request=new MockHttpServletRequest("PUT","/api/admin;probe/games/lol/attributes");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        var auth=AccountControllerTestConfig.principal();
        ApiException denied=assertThrows(ApiException.class,()->writes.recordEditLog(auth.principalId(),auth.displayName(),"PUT",request.getRequestURI(),null,200));
        assertEquals(401,denied.getStatus().value());assertEquals("AUTH.INVALID_CREDENTIALS",denied.getCode());
        verifyNoInteractions(mapper,sessions);assertEquals(0,transactions.commits);assertEquals(1,transactions.rollbacks);
    }
    @Configuration @EnableAspectJAutoProxy @Import({AccountGameWriteGuard.class,PostgresWriteStore.class})
    static class Config {
        @Bean xyz.game.datamanage.support.maintenance.MaintenancePrincipals accountSessions() { return mock(xyz.game.datamanage.support.maintenance.MaintenancePrincipals.class); }
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
