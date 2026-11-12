package xyz.game.datamanage.support.maintenance;

import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

/** 在控制器外建立事务，原有业务服务、编辑留痕及批次事实在同一提交中完成。 */
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE+100)
public class MaintenanceWriteAspect {
    private final MaintenanceBatches batches;
    public MaintenanceWriteAspect(MaintenanceBatches batches) { this.batches=batches; }
    @Around("execution(public * xyz.game.datamanage.controller.adminapi..*(..)) && @within(org.springframework.web.bind.annotation.RestController)")
    public Object write(ProceedingJoinPoint invocation) throws Throwable {
        if(!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) return invocation.proceed();
        HttpServletRequest request=attributes.getRequest();
        if(AdminAuthFilter.publicGameRead(request) || java.util.Set.of("GET","HEAD","OPTIONS").contains(request.getMethod())) return invocation.proceed();
        if(!(request.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) instanceof AuthContext auth) || !auth.maintenance()) throw MaintenanceJson.denied();
        try { return batches.execute(auth,request,()-> {
            try {return invocation.proceed();} catch(RuntimeException|Error e){throw e;}catch(Throwable e){throw new InvocationFailure(e);}
        }); } catch(InvocationFailure e) {throw e.getCause();}
    }
    private static final class InvocationFailure extends RuntimeException { InvocationFailure(Throwable cause){super(cause);} }
}
