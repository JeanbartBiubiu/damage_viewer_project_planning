BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
DO $installation$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
                   WHERE e.extname='pgcrypto' AND n.nspname='public')
       OR to_regprocedure('public.crypt(text,text)') IS NULL
       OR to_regprocedure('public.gen_salt(text,integer)') IS NULL
       OR to_regprocedure('public.gen_random_bytes(integer)') IS NULL THEN
        RAISE EXCEPTION '账号密码扩展必须安装在 public，且所需函数完整';
    END IF;
END
$installation$;

CREATE SCHEMA auth;

-- 账号。可登录就是已付费，账号禁用由 status 独立控制。
CREATE TABLE auth.accounts (
    id uuid PRIMARY KEY,
    username varchar(32) NOT NULL UNIQUE,
    password_hash text NOT NULL CHECK (length(password_hash) > 0),
    status varchar(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'disabled')),
    can_login smallint NOT NULL DEFAULT 0 CHECK (can_login IN (0, 1)),
    can_edit boolean NOT NULL DEFAULT false,
    login_enabled_at timestamptz,
    enablement_reference varchar(128) UNIQUE,
    auth_epoch bigint NOT NULL DEFAULT 1 CHECK (auth_epoch > 0),
    recovery_batch_id uuid,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT accounts_username_format CHECK (username ~ '^[a-z0-9_]{3,32}$'),
    CONSTRAINT accounts_enablement_fields CHECK (
        (can_login = 0 AND login_enabled_at IS NULL AND enablement_reference IS NULL)
        OR
        (can_login = 1 AND login_enabled_at IS NOT NULL
            AND enablement_reference IS NOT NULL AND length(enablement_reference) > 0)
    ),
    CONSTRAINT accounts_active_recovery_batch CHECK (
        status <> 'active' OR recovery_batch_id IS NOT NULL
    )
);

COMMENT ON COLUMN auth.accounts.can_login IS
    '0为从未付费开通，1为已付费；供正式登录和Wasm授权使用，不限制游戏数据读取';

CREATE INDEX accounts_unpaid_cleanup_idx ON auth.accounts (created_at, id)
    WHERE can_login = 0 AND login_enabled_at IS NULL;

-- 只保存已确认的正式验证器，待确认种子保存在受限流程中。
CREATE TABLE auth.totp_credentials (
    account_id uuid PRIMARY KEY REFERENCES auth.accounts(id) ON DELETE CASCADE,
    secret_ciphertext bytea NOT NULL CHECK (octet_length(secret_ciphertext) > 0),
    encryption_key_id varchar(64) NOT NULL CHECK (length(encryption_key_id) > 0),
    credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
    last_used_step bigint NOT NULL CHECK (last_used_step >= 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 每个账号只接受 accounts.recovery_batch_id 指向的当前批次。
CREATE TABLE auth.recovery_codes (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
    batch_id uuid NOT NULL,
    code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT recovery_codes_unique UNIQUE (account_id, batch_id, code_hash)
);

-- 正式会话与对应防跨站请求伪造值仅保存摘要。
CREATE TABLE auth.sessions (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
    auth_epoch bigint NOT NULL CHECK (auth_epoch > 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CONSTRAINT sessions_expiry CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL '30 days'
    )
);

CREATE INDEX sessions_account_idx ON auth.sessions (account_id, expires_at);
CREATE INDEX sessions_expiry_idx ON auth.sessions (expires_at);

-- 用途与阶段固定。恢复码明文只允许在尚未确认的短期密文中暂存。
CREATE TABLE auth.flows (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
    auth_epoch bigint NOT NULL CHECK (auth_epoch > 0),
    purpose varchar(32) NOT NULL CHECK (purpose IN (
        'register', 'login', 'reset_password', 'replace_totp',
        'change_password', 'change_totp', 'regenerate_recovery_codes'
    )),
    phase varchar(32) NOT NULL DEFAULT 'started' CHECK (phase IN (
        'started', 'totp_verified', 'recovery_codes_ready', 'completed', 'revoked'
    )),
    source_session_id uuid REFERENCES auth.sessions(id) ON DELETE SET NULL,
    verified_recovery_code_id uuid REFERENCES auth.recovery_codes(id) ON DELETE SET NULL,
    candidate_secret_ciphertext bytea,
    candidate_credential_version bigint,
    candidate_last_used_step bigint CHECK (candidate_last_used_step >= 0),
    recovery_material_ciphertext bytea,
    encryption_key_id varchar(64) CHECK (length(encryption_key_id) > 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL,
    finished_at timestamptz,
    CONSTRAINT flows_expiry CHECK (
        expires_at > created_at AND expires_at <= created_at +
            CASE WHEN purpose = 'login' THEN INTERVAL '5 minutes'
                 ELSE INTERVAL '10 minutes' END
    ),
    CONSTRAINT flows_terminal_time CHECK (
        (phase IN ('completed', 'revoked')) = (finished_at IS NOT NULL)
    ),
    CONSTRAINT flows_candidate_fields CHECK (
        (candidate_secret_ciphertext IS NULL AND candidate_credential_version IS NULL
            AND candidate_last_used_step IS NULL)
        OR
        (candidate_secret_ciphertext IS NOT NULL
            AND octet_length(candidate_secret_ciphertext) > 0
            AND candidate_credential_version IS NOT NULL AND candidate_credential_version > 0)
    ),
    CONSTRAINT flows_encryption_key CHECK (
        (candidate_secret_ciphertext IS NOT NULL OR recovery_material_ciphertext IS NOT NULL)
            = (encryption_key_id IS NOT NULL)
    ),
    CONSTRAINT flows_recovery_material CHECK (
        recovery_material_ciphertext IS NULL OR octet_length(recovery_material_ciphertext) > 0
    ),
    CONSTRAINT flows_terminal_material_erased CHECK (
        phase NOT IN ('completed', 'revoked') OR
        (candidate_secret_ciphertext IS NULL AND candidate_credential_version IS NULL
            AND candidate_last_used_step IS NULL AND recovery_material_ciphertext IS NULL
            AND encryption_key_id IS NULL)
    )
);

CREATE INDEX flows_account_idx ON auth.flows (account_id);
CREATE INDEX flows_expiry_idx ON auth.flows (expires_at);
CREATE INDEX flows_source_session_idx ON auth.flows (source_session_id)
    WHERE source_session_id IS NOT NULL;
CREATE UNIQUE INDEX flows_one_credential_change_idx ON auth.flows (account_id)
    WHERE purpose <> 'login' AND phase IN ('started', 'totp_verified', 'recovery_codes_ready');

-- 限流计数独立提交，不能随认证失败一起回滚。
CREATE TABLE auth.rate_limits (
    scope varchar(32) NOT NULL CHECK (scope IN (
        'password_account', 'password_ip', 'totp_account', 'totp_flow', 'register_ip'
    )),
    subject_hash bytea NOT NULL CHECK (octet_length(subject_hash) = 32),
    window_started_at timestamptz NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    blocked_until timestamptz,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (scope, subject_hash, window_started_at),
    CONSTRAINT rate_limits_expiry CHECK (expires_at > window_started_at)
);

CREATE INDEX rate_limits_expiry_idx ON auth.rate_limits (expires_at);

-- 安全事件不随账号清理级联删除，字段内容由服务白名单筛选。
CREATE TABLE auth.security_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id uuid REFERENCES auth.accounts(id) ON DELETE SET NULL,
    actor_account_id uuid REFERENCES auth.accounts(id) ON DELETE SET NULL,
    actor_kind varchar(16) NOT NULL
        CHECK (actor_kind IN ('anonymous', 'account', 'internal', 'system')),
    actor_reference varchar(128),
    event_type varchar(64) NOT NULL CHECK (length(event_type) > 0),
    result varchar(16) NOT NULL CHECK (result IN ('success', 'failure')),
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX security_events_retention_idx ON auth.security_events (created_at, id);
CREATE INDEX security_events_account_idx ON auth.security_events (account_id, created_at);
CREATE INDEX security_events_actor_idx ON auth.security_events (actor_account_id)
    WHERE actor_account_id IS NOT NULL;


-- 编辑记录保留账号删除前的用户名快照；新库不创建旧邮箱身份表。
CREATE SCHEMA IF NOT EXISTS "user";
CREATE TABLE "user".edit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legacy_email varchar,
    account_id uuid REFERENCES auth.accounts(id) ON DELETE SET NULL,
    username_snapshot varchar(32),
    edit_body text NOT NULL,
    create_time timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT edit_log_actor_snapshot CHECK (legacy_email IS NOT NULL OR username_snapshot IS NOT NULL)
);
CREATE INDEX edit_log_account_idx ON "user".edit_log (account_id, create_time);
COMMIT;
