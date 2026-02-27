-- =============================================================================
-- Damage Viewer System - User Management Schema (Tables)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS "user";

CREATE SEQUENCE IF NOT EXISTS "user".email_id_seq;
CREATE SEQUENCE IF NOT EXISTS "user".edit_log_id_seq;

CREATE TABLE IF NOT EXISTS "user".email (
    email varchar NOT NULL,
    password_hash varchar NOT NULL,
    is_pay boolean NOT NULL DEFAULT false,
    can_edit boolean NOT NULL DEFAULT false,
    id bigint NOT NULL DEFAULT nextval('"user".email_id_seq'::regclass),
    order_id varchar,
    create_time timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT email_pk PRIMARY KEY (id),
    CONSTRAINT email_unique UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS "user".edit_log (
    id bigint NOT NULL DEFAULT nextval('"user".edit_log_id_seq'::regclass),
    email varchar NOT NULL,
    edit_body text NOT NULL,
    create_time timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT edit_log_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "user".pv_uv (
    hour bigint NOT NULL,
    pv bigint NOT NULL,
    uv bigint NOT NULL,
    CONSTRAINT pk_pv_uv PRIMARY KEY (hour)
);

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobname = 'edit_log_cleanup'
    ) THEN
        PERFORM cron.unschedule('edit_log_cleanup');
    END IF;

    PERFORM cron.schedule(
        'edit_log_cleanup',
        '0 3 * * *',
        $sql$DELETE FROM "user".edit_log
          WHERE create_time < now() - interval '7 days';$sql$
    );
END $do$;
