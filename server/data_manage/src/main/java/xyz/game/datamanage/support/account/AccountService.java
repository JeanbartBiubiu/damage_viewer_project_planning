package xyz.game.datamanage.support.account;

import jakarta.servlet.http.HttpServletRequest;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiFunction;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import xyz.game.datamanage.support.account.AccountStore.Account;
import xyz.game.datamanage.support.account.AccountStore.Credential;
import xyz.game.datamanage.support.account.AccountStore.Flow;
import xyz.game.datamanage.support.account.AccountStore.Session;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.ApiException;

/** 各用途的阶段和最终提交规则；不向编辑日志传递任何账号请求。 */
@Service
public class AccountService {
    public record Issued(Object view, String token, String csrf, Instant createdAt, Instant expiresAt, boolean session) {
        @Override public String toString() { return "Issued[redacted]"; }
    }
    private final AccountStore store;
    private final AccountCrypto crypto;
    private final PasswordTasks passwords;
    private final AccountDatabaseCrypto database;
    private final AccountRateLimits limits;
    private final AccountProperties properties;
    private final AccountBrowser browser;
    public AccountService(AccountStore store, AccountCrypto crypto, PasswordTasks passwords, AccountRateLimits limits,
                          AccountProperties properties, AccountBrowser browser,AccountDatabaseCrypto database) {
        this.store=store; this.crypto=crypto; this.passwords=passwords; this.limits=limits; this.properties=properties; this.browser=browser;
        this.database=database;
    }
    public static String username(String raw) {
        if (raw==null || !raw.matches("[A-Za-z0-9_]{3,32}")) throw AccountErrors.bad();
        return raw.toLowerCase(Locale.ROOT);
    }
    private static String candidateAad(Flow f) { return f.accountId()+"|flow:"+f.id()+"|"+f.purpose()+"|totp|"+f.candidateVersion(); }
    private static String credentialAad(UUID id, long version) { return id+"|credential|totp|"+version; }
    private static String materialAad(Flow f) { return f.accountId()+"|flow:"+f.id()+"|"+f.purpose()+"|recovery|"+f.epoch(); }
    private static Object view(Flow f) {
        return "completed".equals(f.phase()) ? Map.of("phase","completed")
            : Map.of("accountId",f.accountId(),"purpose",f.purpose(),"phase",f.phase(),"expiresAt",f.expiresAt());
    }
    private static void phase(Flow f, String expected, Set<String> purposes) {
        if (!expected.equals(f.phase()) || !purposes.contains(f.purpose())) throw AccountErrors.flow();
    }
    public Issued register(String rawUsername, String password, String address) {
        String name=username(rawUsername);
        limits.registration(address);
        String encoded=passwords.encode(password,name);
        try { return store.tx(() -> {
            UUID id=UUID.randomUUID();
            store.jdbc().update("INSERT INTO auth.accounts(id,username,password_hash) VALUES (?,?,?)",id,name,encoded);
            Account a=store.account(id,true);
            Issued issued=start(a,"register",null,null);
            return issued;
        }); } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT,"AUTH.USERNAME_UNAVAILABLE","用户名不可用");
        }
    }
    private record PasswordProof(Account snapshot,AccountRateLimits.PasswordAttempt attempt) implements AutoCloseable {
        @Override public void close() { attempt.close(); }
        @Override public String toString() { return "PasswordProof[redacted]"; }
    }
    private PasswordProof passwordProof(String rawUsername, String password, String address) {
        String name=username(rawUsername);
        var attempt=limits.reservePasswordAttempt(name,address);
        boolean transferred=false;
        try {
            Account snapshot=store.byUsername(name);
            if (!passwords.matches(password,snapshot==null?null:snapshot.passwordHash())) {
                attempt.retainFailure();throw AccountErrors.invalid();
            }
            transferred=true;return new PasswordProof(snapshot,attempt);
        } finally {
            if(!transferred) attempt.close();
        }
    }
    private Account recheck(Account snapshot) {
        Account current=store.account(snapshot.id(),true);
        if (current==null || current.epoch()!=snapshot.epoch() || !current.passwordHash().equals(snapshot.passwordHash())) throw AccountErrors.invalid();
        return current;
    }
    public Issued login(String rawUsername, String password, String address) {
        try(var proof=passwordProof(rawUsername,password,address)) {
          return store.tx(() -> {
            Account current=recheck(proof.snapshot());
            if ("disabled".equals(current.status())) throw new ApiException(HttpStatus.FORBIDDEN,"AUTH.ACCOUNT_DISABLED","账号已禁用");
            // 续办保持原注册时间、已到账开通状态及账号编号。
            return start(current,"pending".equals(current.status())?"register":"login",null,null);
          });
        }
    }
    private Issued start(Account account, String purpose, UUID sourceSession, UUID recoveryCode) {
        if (!"login".equals(purpose)) store.revokeChanges(account.id());
        var tokens=database.tokens();String token=tokens.token(),csrf=tokens.csrf();
        UUID id=UUID.randomUUID();
        store.jdbc().update("""
            INSERT INTO auth.flows(id,account_id,token_hash,csrf_hash,auth_epoch,purpose,source_session_id,verified_recovery_code_id,expires_at)
            VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP + CASE WHEN ?='login' THEN INTERVAL '5 minutes' ELSE INTERVAL '10 minutes' END)
            """,id,account.id(),AccountCrypto.hash(token),AccountCrypto.hash(csrf),account.epoch(),purpose,sourceSession,recoveryCode,purpose);
        Flow f=store.flow(AccountCrypto.hash(token),false);
        store.event(account.id(),sourceSession==null?null:account.id(),sourceSession==null?"anonymous":"account","account."+purpose+"_started");
        return new Issued(view(f),token,csrf,store.now(),f.expiresAt(),false);
    }
    /** 用流程摘要取得账号后，严格按账号→流程→凭证/会话顺序锁定。 */
    private <T> T withFlow(HttpServletRequest request, boolean statusOnly, BiFunction<Account,Flow,T> action) {
        String token=AccountBrowser.cookie(request,AccountBrowser.FLOW);
        if (token==null) throw AccountErrors.invalid();
        byte[] hash=AccountCrypto.hash(token);
        Flow found=store.flow(hash,false);
        if (found==null) throw AccountErrors.invalid();
        return store.tx(() -> {
            Account account=store.account(found.accountId(),true);
            if (account==null) throw AccountErrors.invalid();
            Flow f=store.flow(hash,true);
            if (f==null) throw AccountErrors.invalid();
            if (!store.now().isBefore(f.expiresAt())) throw AccountErrors.expired();
            if ("revoked".equals(f.phase())) throw AccountErrors.flow();
            browser.csrf(request,true,f.csrfHash());
            request.setAttribute(AccountBrowser.FLOW_CSRF_RESPONSE_ATTR,AccountBrowser.cookie(request,AccountBrowser.FLOW_CSRF));
            if (statusOnly && "completed".equals(f.phase())) return action.apply(account,f);
            if ("completed".equals(f.phase()) || account.epoch()!=f.epoch()) throw AccountErrors.flow();
            if ("disabled".equals(account.status())) throw new ApiException(HttpStatus.FORBIDDEN,"AUTH.ACCOUNT_DISABLED","账号已禁用");
            if (Set.of("change_password","change_totp","regenerate_recovery_codes").contains(f.purpose())) {
                Session source=f.sourceSession()==null?null:store.session(f.sourceSession());
                if (!validSession(source,account)) throw AccountErrors.flow();
            }
            if (Set.of("reset_password","replace_totp").contains(f.purpose())) recoveryStillValid(account,f.recoveryCodeId());
            return action.apply(account,f);
        });
    }
    public Object status(HttpServletRequest request) { return withFlow(request,true,(a,f)->view(f)); }
    public Map<String,String> setup(HttpServletRequest request) {
        return withFlow(request,false,(a,f)-> {
            phase(f,"started",Set.of("register","replace_totp","change_totp"));
            if (f.candidate()==null) {
                Credential old=store.credential(a.id());
                long version=old==null?1:old.version()+1;
                String aad=a.id()+"|flow:"+f.id()+"|"+f.purpose()+"|totp|"+version;
                byte[] encrypted=crypto.encrypt(database.totpSecret(),aad);
                store.jdbc().update("UPDATE auth.flows SET candidate_secret_ciphertext=?,candidate_credential_version=?,encryption_key_id=? WHERE id=?",encrypted,version,properties.getAeadKeyId(),f.id());
                f=store.flow(AccountCrypto.hash(AccountBrowser.cookie(request,AccountBrowser.FLOW)),false);
            }
            return crypto.setup(a.username(),crypto.decrypt(f.candidate(),candidateAad(f),f.keyId()));
        });
    }
    public Object verifyCandidate(HttpServletRequest request, String code) {
        return limitedTotp(request,()->withFlow(request,false,(a,f)-> {
            phase(f,"started",Set.of("register","replace_totp","change_totp"));
            if (f.candidate()==null) throw AccountErrors.flow();
            long step=crypto.matchingStep(crypto.decrypt(f.candidate(),candidateAad(f),f.keyId()),code,store.now(),f.candidateStep()==null?-1:f.candidateStep());
            store.jdbc().update("UPDATE auth.flows SET candidate_last_used_step=?,phase='totp_verified' WHERE id=?",step,f.id());
            ready(a,f);
            return view(store.flow(AccountCrypto.hash(AccountBrowser.cookie(request,AccountBrowser.FLOW)),false));
        }));
    }
    private void ready(Account account, Flow flow) {
        List<String> codes=database.recoveryCodes();
        // 码的永久摘要在最终确认事务中写入，短期明文只存在本流程的密文中。
        byte[] material=crypto.encrypt(String.join("\n",codes),materialAad(flow));
        store.jdbc().update("UPDATE auth.flows SET recovery_material_ciphertext=?,encryption_key_id=?,phase='recovery_codes_ready' WHERE id=?",material,properties.getAeadKeyId(),flow.id());
    }
    public Object recoveryCodes(HttpServletRequest request) {
        return withFlow(request,false,(a,f)-> {
            phase(f,"recovery_codes_ready",Set.of("register","replace_totp","change_totp","regenerate_recovery_codes"));
            if (f.material()==null) throw AccountErrors.flow();
            return Map.of("codes",List.of(crypto.decrypt(f.material(),materialAad(f),f.keyId()).split("\n")),"expiresAt",f.expiresAt());
        });
    }
    public Object confirmRecoveryCodes(HttpServletRequest request) {
        return withFlow(request,false,(a,f)-> {
            phase(f,"recovery_codes_ready",Set.of("register","replace_totp","change_totp","regenerate_recovery_codes"));
            if (f.material()==null) throw AccountErrors.flow();
            if ("replace_totp".equals(f.purpose())) consumeRecovery(a,f.recoveryCodeId());
            UUID batch=UUID.randomUUID();
            String[] codes=crypto.decrypt(f.material(),materialAad(f),f.keyId()).split("\n");
            if (codes.length!=10) throw AccountErrors.flow();
            if (!"regenerate_recovery_codes".equals(f.purpose())) {
                if (f.candidate()==null || f.candidateStep()==null || f.candidateVersion()==null) throw AccountErrors.flow();
                String secret=crypto.decrypt(f.candidate(),candidateAad(f),f.keyId());
                byte[] ciphertext=crypto.encrypt(secret,credentialAad(a.id(),f.candidateVersion()));
                store.jdbc().update("""
                    INSERT INTO auth.totp_credentials(account_id,secret_ciphertext,encryption_key_id,credential_version,last_used_step)
                    VALUES (?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,
                        encryption_key_id=excluded.encryption_key_id,credential_version=excluded.credential_version,
                        last_used_step=excluded.last_used_step,updated_at=CURRENT_TIMESTAMP
                    """,a.id(),ciphertext,properties.getAeadKeyId(),f.candidateVersion(),f.candidateStep());
            }
            for (String code:codes) store.jdbc().update("INSERT INTO auth.recovery_codes(id,account_id,batch_id,code_hash) VALUES (?,?,?,?)",UUID.randomUUID(),a.id(),batch,AccountCrypto.hash(code));
            store.jdbc().update("UPDATE auth.accounts SET recovery_batch_id=?,status=CASE WHEN status='pending' THEN 'active' ELSE status END,auth_epoch=auth_epoch+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",batch,a.id());
            store.revokeSessions(a.id(),f.id()); store.finish(f.id());
            store.event(a.id(),f.sourceSession()==null?null:a.id(),f.sourceSession()==null?"anonymous":"account","account."+f.purpose()+"_completed");
            return Map.of("phase","completed");
        });
    }
    private long currentTotp(Account account, String code) {
        Credential credential=store.credential(account.id());
        if (credential==null) throw AccountErrors.invalid();
        String secret=crypto.decrypt(credential.ciphertext(),credentialAad(account.id(),credential.version()),credential.keyId());
        long step=crypto.matchingStep(secret,code,store.now(),credential.lastStep());
        store.jdbc().update("UPDATE auth.totp_credentials SET last_used_step=?,updated_at=CURRENT_TIMESTAMP WHERE account_id=? AND last_used_step<?",step,account.id(),step);
        return step;
    }
    public Issued loginTotp(HttpServletRequest request, String code) {
        return limitedTotp(request,()->withFlow(request,false,(a,f)-> {
            phase(f,"started",Set.of("login"));
            AccountErrors.enabled(a);
            currentTotp(a,code);
            var tokens=database.tokens();String token=tokens.token(),csrf=tokens.csrf(); UUID id=UUID.randomUUID();
            store.jdbc().update("INSERT INTO auth.sessions(id,account_id,token_hash,csrf_hash,auth_epoch,expires_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP+INTERVAL '30 days')",id,a.id(),AccountCrypto.hash(token),AccountCrypto.hash(csrf),a.epoch());
            Session s=store.session(id);
            store.finish(f.id()); store.event(a.id(),a.id(),"account","account.login");
            return new Issued(Map.of("accountId",a.id(),"username",a.username(),"canLogin",1,"canEdit",a.canEdit(),"expiresAt",s.expiresAt()),token,csrf,store.now(),s.expiresAt(),true);
        }));
    }
    private UUID recoveryId(Account account,String code) {
        if (code==null || !code.matches("[A-Za-z0-9_-]{22}")) throw AccountErrors.invalid();
        UUID id=store.first("SELECT id FROM auth.recovery_codes WHERE account_id=? AND batch_id=? AND code_hash=? AND used_at IS NULL FOR UPDATE",(r,n)->r.getObject(1,UUID.class),account.id(),account.batchId(),AccountCrypto.hash(code));
        if (id==null) throw AccountErrors.invalid();
        return id;
    }
    private void recoveryStillValid(Account account,UUID id) {
        if (id==null || store.first("SELECT id FROM auth.recovery_codes WHERE id=? AND account_id=? AND batch_id=? AND used_at IS NULL FOR UPDATE",(r,n)->r.getObject(1,UUID.class),id,account.id(),account.batchId())==null) throw AccountErrors.flow();
    }
    private void consumeRecovery(Account account,UUID id) {
        recoveryStillValid(account,id);
        int rows=store.jdbc().update("UPDATE auth.recovery_codes SET used_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND batch_id=? AND used_at IS NULL",id,account.id(),account.batchId());
        if (rows!=1) throw AccountErrors.flow();
    }
    public Issued recoverPassword(String rawUsername,String code,String recoveryCode,String address) {
        String name=username(rawUsername);
        Account initial=store.byUsername(name);
        String subject=initial==null?"unknown:"+name:initial.id().toString();
        limits.check("password_ip",address); limits.reserveTotp("totp_account",subject);
        try { return store.tx(()-> {
            Account found=store.byUsername(name);
            if (found==null) throw AccountErrors.invalid();
            Account a=store.account(found.id(),true);
            if (a==null || !"active".equals(a.status())) throw AccountErrors.invalid();
            UUID recovery=recoveryId(a,recoveryCode); currentTotp(a,code);
            return start(a,"reset_password",null,recovery);
        }); } catch (ApiException e) {
            if (e.getStatus()==HttpStatus.UNAUTHORIZED) limits.fail("password_ip",address);
            throw e;
        }
    }
    public Issued recoverTotp(String rawUsername,String password,String recoveryCode,String address) {
        try(var proof=passwordProof(rawUsername,password,address)) {
          try { return store.tx(()-> {
            Account a=recheck(proof.snapshot());
            if (!"active".equals(a.status())) throw AccountErrors.invalid();
            return start(a,"replace_totp",null,recoveryId(a,recoveryCode));
        }); } catch (ApiException e) {
            if (e.getStatus()==HttpStatus.UNAUTHORIZED) proof.attempt().retainFailure();
            throw e;
          }
        }
    }
    public Issued security(AuthContext auth,String currentPassword,String code,String purpose,String address) {
        try(var proof=passwordProof(auth.username(),currentPassword,address)) {
        limits.reserveTotp("totp_account",auth.accountId().toString());
        try { return store.tx(()-> {
            Account a=recheck(proof.snapshot());
            if (!a.id().equals(auth.accountId()) || auth.authEpoch()!=a.epoch() || !validSession(store.session(auth.sessionId()),a)) throw AccountErrors.invalid();
            AccountErrors.enabled(a); currentTotp(a,code);
            Issued result=start(a,purpose,auth.sessionId(),null);
            if ("regenerate_recovery_codes".equals(purpose)) {
                Flow f=store.flow(AccountCrypto.hash(result.token()),false); ready(a,f);
                return new Issued(view(store.flow(AccountCrypto.hash(result.token()),false)),result.token(),result.csrf(),result.createdAt(),result.expiresAt(),false);
            }
            return result;
        }); } catch (ApiException e) { throw e; }
        }
    }
    public Object completePassword(HttpServletRequest request,String newPassword) {
        // 快速读取阶段与本人用户名后在事务外计算哈希；提交时重新完整检查流程、版本、来源会话。
        String name=withFlow(request,false,(a,f)-> { phase(f,"started",Set.of("reset_password","change_password")); return a.username(); });
        String encoded=passwords.encode(newPassword,name);
        return withFlow(request,false,(a,f)-> {
            phase(f,"started",Set.of("reset_password","change_password"));
            if ("reset_password".equals(f.purpose())) consumeRecovery(a,f.recoveryCodeId());
            store.jdbc().update("UPDATE auth.accounts SET password_hash=?,auth_epoch=auth_epoch+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",encoded,a.id());
            store.revokeSessions(a.id(),f.id()); store.finish(f.id());
            store.event(a.id(),f.sourceSession()==null?null:a.id(),f.sourceSession()==null?"anonymous":"account","account."+f.purpose()+"_completed");
            return Map.of("phase","completed");
        });
    }
    public void logout(HttpServletRequest request, boolean all) {
        String token=AccountBrowser.cookie(request,AccountBrowser.SESSION);
        if (token==null) { if (all) throw AccountErrors.invalid(); return; }
        Session found=store.session(AccountCrypto.hash(token));
        if (found==null) { if (all) throw AccountErrors.invalid(); return; }
        store.tx(()-> {
            Account a=store.account(found.accountId(),true);
            if (a==null) return null;
            Session s=store.session(found.id());
            browser.csrf(request,false,s.csrfHash());
            if (!validSession(s,a)) { if (all) throw AccountErrors.invalid(); return null; }
            if (all) {
                store.jdbc().update("UPDATE auth.accounts SET auth_epoch=auth_epoch+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",a.id());
                store.revokeSessions(a.id(),UUID.randomUUID());
            } else {
                store.jdbc().update("UPDATE auth.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?",s.id());
                store.jdbc().update("UPDATE auth.flows SET phase='revoked',finished_at=CURRENT_TIMESTAMP,candidate_secret_ciphertext=NULL,candidate_credential_version=NULL,candidate_last_used_step=NULL,recovery_material_ciphertext=NULL,encryption_key_id=NULL WHERE source_session_id=? AND phase NOT IN ('completed','revoked')",s.id());
            }
            store.event(a.id(),a.id(),"account",all?"account.logout_all":"account.logout"); return null;
        });
    }
    public Object grant(AuthContext auth) {
        return store.tx(()-> {
            Account a=store.account(auth.accountId(),true);
            if (a==null || !validSession(store.session(auth.sessionId()),a) || a.epoch()!=auth.authEpoch()) throw AccountErrors.invalid();
            AccountErrors.enabled(a);
            if (store.credential(a.id())==null) throw AccountErrors.invalid();
            return crypto.grant(a.id(),store.now());
        });
    }
    private boolean validSession(Session s,Account a) {
        return s!=null && s.accountId().equals(a.id()) && s.epoch()==a.epoch() && s.revokedAt()==null && store.now().isBefore(s.expiresAt());
    }
    private <T> T limitedTotp(HttpServletRequest request,java.util.function.Supplier<T> work) {
        String raw=AccountBrowser.cookie(request,AccountBrowser.FLOW);
        if (raw==null) throw AccountErrors.invalid();
        Flow f=store.flow(AccountCrypto.hash(raw),false);
        if (f==null) throw AccountErrors.invalid();
        if (!store.now().isBefore(f.expiresAt())) throw AccountErrors.expired();
        if (Set.of("completed","revoked").contains(f.phase())) throw AccountErrors.flow();
        browser.csrf(request,true,f.csrfHash());
        String account=f.accountId().toString(), flow=f.id().toString();
        limits.reserveTotp("totp_flow",flow); limits.reserveTotp("totp_account",account);
        return work.get();
    }
}
