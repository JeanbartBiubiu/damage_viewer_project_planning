package xyz.game.datamanage.support.account;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import xyz.game.datamanage.support.error.ApiException;

@Service
@EnableScheduling
public class AccountMaintenance {
    private static final Logger log=LoggerFactory.getLogger(AccountMaintenance.class);
    private final AccountStore store;
    private final AccountProperties properties;
    public AccountMaintenance(AccountStore store,AccountProperties properties) { this.store=store; this.properties=properties; }
    public Object enable(UUID id,String reference) {
        if (reference==null || !reference.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")) throw AccountErrors.bad();
        try { return store.tx(()-> {
            AccountStore.Account a=store.account(id,true);
            if (a==null) throw new ApiException(HttpStatus.NOT_FOUND,"AUTH.ACCOUNT_NOT_FOUND","账号不存在");
            if (a.canLogin()==1) {
                if (!reference.equals(a.enablementReference())) throw conflict();
                return Map.of("accountId",id,"canLogin",1,"enabledAt",a.enabledAt(),"changed",false);
            }
            store.jdbc().update("UPDATE auth.accounts SET can_login=1,login_enabled_at=CURRENT_TIMESTAMP,enablement_reference=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND can_login=0 AND login_enabled_at IS NULL",reference,id);
            store.event(id,null,"internal","account.login_enabled");
            return Map.of("accountId",id,"canLogin",1,"enabledAt",store.account(id,false).enabledAt(),"changed",true);
        }); } catch (DuplicateKeyException e) { throw conflict(); }
    }
    private ApiException conflict() { return new ApiException(HttpStatus.CONFLICT,"AUTH.ENABLEMENT_CONFLICT","账号已开通或关联编号冲突"); }
    /** 运维服务调用，无浏览器路由；禁用变更持有排他账号锁。 */
    public void changeAccess(UUID id,boolean disabled) {
        store.tx(()-> {
            AccountStore.Account a=store.account(id,true);
            if (a==null) throw new ApiException(HttpStatus.NOT_FOUND,"AUTH.ACCOUNT_NOT_FOUND","账号不存在");
            String status=disabled?"disabled":(a.batchId()==null?"pending":"active");
            store.jdbc().update("UPDATE auth.accounts SET status=?,auth_epoch=auth_epoch+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",status,id);
            store.revokeSessions(id,UUID.randomUUID()); store.event(id,null,"internal","account.access_changed"); return null;
        });
    }
    public int cleanupBatch() {
        return store.tx(()-> {
            List<UUID> ids=store.jdbc().queryForList("SELECT id FROM auth.accounts WHERE can_login=0 AND login_enabled_at IS NULL AND created_at<CURRENT_TIMESTAMP-INTERVAL '7 days' ORDER BY created_at,id LIMIT 200 FOR UPDATE SKIP LOCKED",UUID.class);
            int removed=0;
            for (UUID id:ids) {
                store.event(id,null,"system","account.unpaid_cleanup");
                removed+=store.jdbc().update("DELETE FROM auth.accounts WHERE id=? AND can_login=0 AND login_enabled_at IS NULL AND created_at<CURRENT_TIMESTAMP-INTERVAL '7 days'",id);
            }
            return removed;
        });
    }
    private void cleanupExpired() {
        store.tx(()-> {
            List<UUID> accounts=store.jdbc().queryForList("""
                SELECT id FROM auth.accounts a WHERE
                    EXISTS (SELECT 1 FROM auth.flows f WHERE f.account_id=a.id AND f.expires_at<=CURRENT_TIMESTAMP)
                    OR EXISTS (SELECT 1 FROM auth.sessions s WHERE s.account_id=a.id AND s.expires_at<=CURRENT_TIMESTAMP)
                ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED
                """,UUID.class);
            int flowBudget=2000,sessionBudget=2000;
            for (UUID account:accounts) {
                if (flowBudget>0) flowBudget-=store.jdbc().update("DELETE FROM auth.flows WHERE id IN (SELECT id FROM auth.flows WHERE account_id=? AND expires_at<=CURRENT_TIMESTAMP ORDER BY expires_at LIMIT ?)",account,flowBudget);
                if (sessionBudget>0) sessionBudget-=store.jdbc().update("DELETE FROM auth.sessions WHERE id IN (SELECT id FROM auth.sessions WHERE account_id=? AND expires_at<=CURRENT_TIMESTAMP ORDER BY expires_at LIMIT ?)",account,sessionBudget);
                if (flowBudget==0 && sessionBudget==0) break;
            }
            store.jdbc().update("DELETE FROM auth.rate_limits WHERE ctid IN (SELECT ctid FROM auth.rate_limits WHERE expires_at<=CURRENT_TIMESTAMP ORDER BY expires_at LIMIT 2000)");
            store.jdbc().update("DELETE FROM auth.security_events WHERE id IN (SELECT id FROM auth.security_events WHERE created_at<CURRENT_TIMESTAMP-INTERVAL '30 days' ORDER BY created_at,id LIMIT 2000)");
            return null;
        });
    }
    @Scheduled(initialDelayString="${app.auth.cleanup-initial-delay-ms:3600000}",fixedDelayString="${app.auth.cleanup-delay-ms:3600000}")
    public void scheduledCleanup() {
        if (!properties.isCleanupEnabled()) return;
        int removed=0,batches=0;
        long started=System.nanoTime();
        try {
            for (;batches<20;) { int count=cleanupBatch();batches++; removed+=count; if(count<200) break; }
            cleanupExpired();
            log.info("Account cleanup batches={}, removed={}, elapsedMs={}",batches,removed,(System.nanoTime()-started)/1_000_000);
        } catch (RuntimeException e) { log.warn("Account cleanup failed: category={}, removed={}",e.getClass().getSimpleName(),removed); }
    }
}
