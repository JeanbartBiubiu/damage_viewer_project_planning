package xyz.game.datamanage.support.account;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 账号锁先于凭证、流程、会话；所有授权期限以数据库时间为准。 */
@Repository
public class AccountStore {
    public record Account(UUID id, String username, String passwordHash, String status, int canLogin, boolean canEdit,
                          long epoch, UUID batchId, Instant enabledAt, String enablementReference) {}
    public record Flow(UUID id, UUID accountId, long epoch, String purpose, String phase, UUID sourceSession,
                       UUID recoveryCodeId, byte[] candidate, Long candidateVersion, Long candidateStep, byte[] material,
                       String keyId, byte[] csrfHash, Instant expiresAt) {}
    public record Credential(byte[] ciphertext, String keyId, long version, long lastStep) {}
    public record Session(UUID id, UUID accountId, long epoch, byte[] csrfHash, Instant expiresAt, Instant revokedAt) {}
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final TransactionTemplate independent;
    public AccountStore(JdbcTemplate jdbc, PlatformTransactionManager manager) {
        this.jdbc = jdbc;
        transaction = new TransactionTemplate(manager);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        independent = new TransactionTemplate(manager);
        independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }
    /** 必须经代理方法取得目标依赖，禁止业务直接读取代理实例字段。 */
    public JdbcTemplate jdbc() { return jdbc; }
    public <T> T tx(Supplier<T> work) { return transaction.execute(status -> work.get()); }
    public <T> T independent(Supplier<T> work) { return independent.execute(status -> work.get()); }
    public Instant now() { return jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class).toInstant(); }
    public Account byUsername(String username) { return first("SELECT * FROM auth.accounts WHERE username=?", ACCOUNT, username); }
    public Account account(UUID id, boolean lock) { return first("SELECT * FROM auth.accounts WHERE id=?" + (lock ? " FOR UPDATE" : ""), ACCOUNT, id); }
    public Flow flow(byte[] tokenHash, boolean lock) { return first("SELECT * FROM auth.flows WHERE token_hash=?" + (lock ? " FOR UPDATE" : ""), FLOW, tokenHash); }
    public Credential credential(UUID id) {
        return first("SELECT * FROM auth.totp_credentials WHERE account_id=? FOR UPDATE", (r, n) -> new Credential(r.getBytes("secret_ciphertext"),
            r.getString("encryption_key_id"), r.getLong("credential_version"), r.getLong("last_used_step")), id);
    }
    public Session session(byte[] tokenHash) { return first("SELECT * FROM auth.sessions WHERE token_hash=?", SESSION, tokenHash); }
    public Session session(UUID id) { return first("SELECT * FROM auth.sessions WHERE id=?", SESSION, id); }
    public void event(UUID account, UUID actor, String kind, String type) {
        jdbc.update("INSERT INTO auth.security_events(account_id,actor_account_id,actor_kind,event_type,result) VALUES (?,?,?,?, 'success')", account, actor, kind, type);
    }
    public void revokeChanges(UUID account) {
        jdbc.update("UPDATE auth.flows SET phase='revoked', finished_at=CURRENT_TIMESTAMP,candidate_secret_ciphertext=NULL,candidate_credential_version=NULL,candidate_last_used_step=NULL,recovery_material_ciphertext=NULL,encryption_key_id=NULL WHERE account_id=? AND purpose<>'login' AND phase NOT IN ('completed','revoked')", account);
    }
    public void revokeSessions(UUID account, UUID exceptFlow) {
        jdbc.update("UPDATE auth.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE account_id=? AND revoked_at IS NULL", account);
        jdbc.update("UPDATE auth.flows SET phase='revoked',finished_at=CURRENT_TIMESTAMP,candidate_secret_ciphertext=NULL,candidate_credential_version=NULL,candidate_last_used_step=NULL,recovery_material_ciphertext=NULL,encryption_key_id=NULL WHERE account_id=? AND id<>? AND phase NOT IN ('completed','revoked')", account, exceptFlow);
    }
    public void finish(UUID flow) {
        jdbc.update("UPDATE auth.flows SET phase='completed',finished_at=CURRENT_TIMESTAMP,candidate_secret_ciphertext=NULL,candidate_credential_version=NULL,candidate_last_used_step=NULL,recovery_material_ciphertext=NULL,encryption_key_id=NULL WHERE id=?", flow);
    }
    public <T> T first(String sql, RowMapper<T> mapper, Object... args) {
        List<T> rows = jdbc.query(sql, mapper, args);
        return rows.isEmpty() ? null : rows.getFirst();
    }
    static UUID uuid(ResultSet r, String field) throws SQLException { return r.getObject(field, UUID.class); }
    static Instant instant(ResultSet r, String field) throws SQLException { Timestamp t = r.getTimestamp(field); return t == null ? null : t.toInstant(); }
    static final RowMapper<Account> ACCOUNT = (r, n) -> new Account(uuid(r,"id"), r.getString("username"), r.getString("password_hash"),r.getString("status"),r.getInt("can_login"), r.getBoolean("can_edit"),r.getLong("auth_epoch"),uuid(r,"recovery_batch_id"),instant(r,"login_enabled_at"),r.getString("enablement_reference"));
    static final RowMapper<Session> SESSION = (r, n) -> new Session(uuid(r,"id"),uuid(r,"account_id"),r.getLong("auth_epoch"),r.getBytes("csrf_hash"),instant(r,"expires_at"),instant(r,"revoked_at"));
    static final RowMapper<Flow> FLOW = (r, n) -> new Flow(uuid(r,"id"),uuid(r,"account_id"),r.getLong("auth_epoch"),r.getString("purpose"),r.getString("phase"),uuid(r,"source_session_id"),uuid(r,"verified_recovery_code_id"),r.getBytes("candidate_secret_ciphertext"),r.getObject("candidate_credential_version",Long.class),r.getObject("candidate_last_used_step",Long.class),r.getBytes("recovery_material_ciphertext"),r.getString("encryption_key_id"),r.getBytes("csrf_hash"),instant(r,"expires_at"));
}
