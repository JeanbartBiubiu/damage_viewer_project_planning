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
import xyz.game.datamanage.support.maintenance.MaintenancePrincipal;
import xyz.game.datamanage.support.maintenance.MaintenancePrincipals;

@Aspect
@Component
@Order(1)
@EnableTransactionManagement(order=0)
public class AccountGameWriteGuard {
    private final MaintenancePrincipals principals;
    public AccountGameWriteGuard(MaintenancePrincipals principals) { this.principals = principals; }
    @Around("(execution(public * xyz.game.datamanage.service..*(..)) || execution(public * xyz.game.datamanage.controller.adminapi..*(..))) && (@annotation(org.springframework.transaction.annotation.Transactional) || @within(org.springframework.transaction.annotation.Transactional))")
    public Object guard(ProceedingJoinPoint invocation) throws Throwable {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            HttpServletRequest request=attributes.getRequest();
            if (AccountRequestPath.path(request).startsWith("/api/admin/games/") && !AdminAuthFilter.publicGameRead(request)) {
                Object context = request.getAttribute(MaintenancePrincipal.REQUEST_ATTRIBUTE);
                if (!(context instanceof MaintenancePrincipal principal)) throw AccountErrors.invalid();
                if (!TransactionSynchronizationManager.isCurrentTransactionReadOnly()) principals.lock(principal);
            }
        }
        return invocation.proceed();
    }
}
