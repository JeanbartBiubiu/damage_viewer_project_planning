package xyz.game.datamanage.support.maintenance;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.support.account.AccountBrowser;
import xyz.game.datamanage.support.account.AccountCrypto;
import xyz.game.datamanage.support.account.AccountStore;
import xyz.game.datamanage.support.auth.AuthContext;

@Component
public class MaintenanceSessions {
    public static final String SESSION="__Host-damage-maint-session", CSRF="__Host-damage-maint-csrf";
    public static final String RESOLVED=MaintenanceSessions.class.getName()+".resolved";
    public record Resolved(AuthContext context,byte[] csrfHash) {}
    private final AccountStore store;
    private final MaintenanceProperties properties;
    private final SecureRandom random=new SecureRandom();
    public MaintenanceSessions(AccountStore store,MaintenanceProperties properties) { this.store=store;this.properties=properties; }
    public boolean trusted(HttpServletRequest request) { return properties.getTrustedAddresses().contains(request.getRemoteAddr()); }
    public void credential(HttpServletRequest request, boolean deployment) {
        String name=deployment?"X-Damage-Deployment-Token":"X-Damage-Maintenance-Token";
        Path path=deployment?properties.getDeploymentTokenPath():properties.getTokenPath();
        if (!trusted(request)) throw MaintenanceJson.denied();
        try {
            String expected=Files.readString(path,StandardCharsets.UTF_8).strip(); String supplied=request.getHeader(name);
            if (expected.length()<43 || expected.length()>256 || supplied==null || !AccountCrypto.same(expected,supplied)) throw MaintenanceJson.denied();
        } catch (java.io.IOException|NullPointerException e) { throw MaintenanceJson.denied(); }
    }
    public Object create(HttpServletRequest request,HttpServletResponse response) {
        credential(request,false); mutation(request);
        UUID principal=properties.getPrincipalId();
        if(principal==null || properties.getCredentialVersion()<1 || properties.getDisplayName()==null || properties.getDisplayName().isBlank()
            || properties.getDisplayName().length()>32) throw MaintenanceJson.denied();
        return store.tx(()-> {
            byte[] tokenHash=AccountCrypto.hash(request.getHeader("X-Damage-Maintenance-Token"));
            store.jdbc().update("INSERT INTO auth.maintenance_principals(id,display_name,credential_version,token_hash) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING",principal,properties.getDisplayName(),properties.getCredentialVersion(),tokenHash);
            Map<String,Object> row=store.jdbc().queryForMap("SELECT credential_version,token_hash,disabled FROM auth.maintenance_principals WHERE id=? FOR UPDATE",principal);
            long version=((Number)row.get("credential_version")).longValue();
            if (properties.getCredentialVersion()>version) {
                store.jdbc().update("UPDATE auth.maintenance_principals SET credential_version=?,token_hash=?,disabled=false,display_name=? WHERE id=?",properties.getCredentialVersion(),tokenHash,properties.getDisplayName(),principal);
                version=properties.getCredentialVersion();
            } else if(properties.getCredentialVersion()!=version || Boolean.TRUE.equals(row.get("disabled")) || !MessageDigest.isEqual((byte[])row.get("token_hash"),tokenHash)) throw MaintenanceJson.denied();
            Instant now=store.now(),expiry=now.plusSeconds(1800); String token=random(),csrf=random();UUID session=UUID.randomUUID();
            store.jdbc().update("INSERT INTO auth.maintenance_sessions(id,principal_id,credential_version,token_hash,csrf_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",session,principal,version,AccountCrypto.hash(token),AccountCrypto.hash(csrf),java.sql.Timestamp.from(now),java.sql.Timestamp.from(expiry));
            issue(response,token,csrf,Duration.between(now,expiry));
            return Map.of("principalId",principal,"displayName",properties.getDisplayName(),"expiresAt",expiry);
        });
    }
    public Resolved resolve(HttpServletRequest request) {
        if (!trusted(request)) throw MaintenanceJson.denied();
        String token=AccountBrowser.cookie(request,SESSION);
        if(token==null) throw new xyz.game.datamanage.support.error.ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED,"MAINTENANCE.SESSION_REQUIRED","维护会话已失效");
        Resolved value=store.first("""
            SELECT s.id,s.principal_id,s.credential_version,s.csrf_hash,s.expires_at,p.display_name
            FROM auth.maintenance_sessions s JOIN auth.maintenance_principals p ON p.id=s.principal_id
            WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
              AND NOT p.disabled AND p.credential_version=s.credential_version
            """,(r,n)->new Resolved(new AuthContext(r.getObject("principal_id",UUID.class),r.getString("display_name"),true,
                r.getObject("id",UUID.class),r.getLong("credential_version"),r.getTimestamp("expires_at").toInstant()),r.getBytes("csrf_hash")),AccountCrypto.hash(token));
        if(value==null) throw new xyz.game.datamanage.support.error.ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED,"MAINTENANCE.SESSION_REQUIRED","维护会话已失效");
        return value;
    }
    public Resolved require(HttpServletRequest request,boolean mutation) {
        Resolved value=resolve(request); if(mutation) { mutation(request); csrf(request,value.csrfHash()); }
        request.setAttribute(RESOLVED,value);return value;
    }
    public void lock(AuthContext auth) {
        if(!auth.maintenance() || !TransactionSynchronizationManager.isActualTransactionActive()) throw MaintenanceJson.denied();
        UUID id=store.first("SELECT id FROM auth.maintenance_principals WHERE id=? FOR SHARE",(r,n)->r.getObject(1,UUID.class),auth.accountId());
        if(id==null) throw MaintenanceJson.denied();
        Boolean accepted=store.first("SELECT true FROM auth.maintenance_sessions s JOIN auth.maintenance_principals p ON p.id=s.principal_id WHERE p.id=? AND s.id=? AND NOT p.disabled AND p.credential_version=? AND s.credential_version=p.credential_version AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()",(r,n)->r.getBoolean(1),auth.accountId(),auth.sessionId(),auth.authEpoch());
        if(!Boolean.TRUE.equals(accepted)) throw MaintenanceJson.denied();
    }
    public void mutation(HttpServletRequest request) {
        String origin=request.getHeader("Origin");
        if(origin==null || !properties.getAllowedOrigins().contains(origin) || !"web".equals(request.getHeader("X-Damage-Client"))
            || request.getContentType()==null || !request.getContentType().split(";",2)[0].strip().equalsIgnoreCase("application/json")) throw MaintenanceJson.denied();
    }
    private void csrf(HttpServletRequest request,byte[] expected) {
        String cookie=AccountBrowser.cookie(request,CSRF),header=request.getHeader("X-CSRF-Token");
        if(cookie==null || !AccountCrypto.same(cookie,header) || !MessageDigest.isEqual(AccountCrypto.hash(cookie),expected)) throw MaintenanceJson.denied();
    }
    public void logout(AuthContext auth,HttpServletResponse response) {
        store.tx(()-> {lock(auth); store.jdbc().update("UPDATE auth.maintenance_sessions SET revoked_at=clock_timestamp() WHERE id=?",auth.sessionId());return null;}); issue(response,"","",Duration.ZERO);
    }
    public void revoke(HttpServletRequest request) {
        credential(request,false);mutation(request);
        store.tx(()-> {store.jdbc().update("UPDATE auth.maintenance_principals SET disabled=true,credential_version=credential_version+1 WHERE id=?",properties.getPrincipalId());return null;});
    }
    public static Map<String,Object> view(AuthContext auth) { return Map.of("principalId",auth.accountId(),"displayName",auth.username(),"expiresAt",auth.expiresAt()); }
    private String random() { byte[] bytes=new byte[32];random.nextBytes(bytes);return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static void issue(HttpServletResponse response,String token,String csrf,Duration duration) {
        response.addHeader(HttpHeaders.SET_COOKIE,ResponseCookie.from(SESSION,token).secure(true).httpOnly(true).sameSite("Strict").path("/").maxAge(duration).build().toString());
        response.addHeader(HttpHeaders.SET_COOKIE,ResponseCookie.from(CSRF,csrf).secure(true).httpOnly(false).sameSite("Strict").path("/").maxAge(duration).build().toString());
    }
}
