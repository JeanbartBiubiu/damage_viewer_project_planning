package xyz.game.datamanage.support.account;

import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@Aspect
@Component
@Order(1)
@EnableTransactionManagement(order=0)
public class AccountGameWriteGuard {
    private final AccountSessions sessions;
    public AccountGameWriteGuard(AccountSessions sessions) { this.sessions = sessions; }
    @Around("(execution(public * xyz.game.datamanage.service..*(..)) || execution(public * xyz.game.datamanage.controller.adminapi..*(..))) && (@annotation(org.springframework.transaction.annotation.Transactional) || @within(org.springframework.transaction.annotation.Transactional))")
    public Object guard(ProceedingJoinPoint invocation) throws Throwable {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            HttpServletRequest request=attributes.getRequest();
            if (!AdminAuthFilter.publicGameRead(request)) {
                Object context=request.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR);
                if (!(context instanceof AuthContext auth)) throw AccountErrors.invalid();
                if (!TransactionSynchronizationManager.isCurrentTransactionReadOnly()) sessions.lockEditor(auth);
            }
        }
        return invocation.proceed();
    }
}
