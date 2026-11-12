BEGIN;
-- 前置：现行账号结构含 can_edit；账号、会话及历史编辑记录保留。
DO $precondition$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='accounts' AND column_name='can_edit')
       OR to_regclass('auth.maintenance_principals') IS NOT NULL THEN
        RAISE EXCEPTION '维护身份迁移前置结构不匹配';
    END IF;
END
$precondition$;
ALTER TABLE auth.accounts DROP COLUMN can_edit;
-- 独立维护身份不属于玩家账号，长期凭据仅保存摘要。
CREATE TABLE auth.maintenance_principals (
    id uuid PRIMARY KEY,
    display_name varchar(32) NOT NULL CHECK (length(display_name)>0),
    credential_version bigint NOT NULL CHECK (credential_version>0),
    token_hash bytea NOT NULL CHECK (octet_length(token_hash)=32),
    disabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE auth.maintenance_sessions (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL REFERENCES auth.maintenance_principals(id),
    credential_version bigint NOT NULL CHECK (credential_version>0),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
    csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash)=32),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at>created_at AND expires_at<=created_at+INTERVAL '30 minutes')
);
CREATE INDEX maintenance_sessions_principal_idx ON auth.maintenance_sessions(principal_id,expires_at);
CREATE TABLE auth.maintenance_batches (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL REFERENCES auth.maintenance_principals(id),
    game_id varchar(64) NOT NULL CHECK (game_id ~ '^[a-z0-9_]+$'),
    reference varchar(256) NOT NULL CHECK (length(reference)>0),
    source_revision varchar(256) NOT NULL CHECK (length(source_revision)>0),
    baseline_digest char(64) NOT NULL CHECK (baseline_digest ~ '^[0-9a-f]{64}$'),
    candidate_digest char(64) NOT NULL CHECK (candidate_digest ~ '^[0-9a-f]{64}$'),
    current_digest char(64) NOT NULL CHECK (current_digest ~ '^[0-9a-f]{64}$'),
    operations jsonb NOT NULL CHECK (jsonb_typeof(operations)='array' AND jsonb_array_length(operations) BETWEEN 1 AND 100),
    receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
    state varchar(16) NOT NULL CHECK (state IN ('PREPARED','OPEN','COMPLETE','FAILED')),
    next_operation integer NOT NULL CHECK (next_operation>=0 AND next_operation<=jsonb_array_length(operations)),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX maintenance_batches_open_game_idx ON auth.maintenance_batches(game_id) WHERE state='OPEN';
CREATE TABLE auth.maintenance_commits (
    batch_id uuid NOT NULL REFERENCES auth.maintenance_batches(id),
    operation_index integer NOT NULL CHECK (operation_index>=0),
    principal_id uuid NOT NULL REFERENCES auth.maintenance_principals(id),
    method varchar(6) NOT NULL CHECK (method IN ('POST','PUT','PATCH','DELETE')),
    path text NOT NULL,
    body_sha256 char(64) NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    before_digest char(64) NOT NULL CHECK (before_digest ~ '^[0-9a-f]{64}$'),
    after_digest char(64) NOT NULL CHECK (after_digest ~ '^[0-9a-f]{64}$'),
    committed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(batch_id,operation_index)
);
ALTER TABLE "user".edit_log ADD COLUMN maintenance_principal_id uuid REFERENCES auth.maintenance_principals(id);

COMMIT;
