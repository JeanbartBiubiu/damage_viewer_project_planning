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
    CONSTRAINT email_unique UNIQUE (email),
    CONSTRAINT email_can_edit_not_null CHECK (can_edit IS NOT NULL),
    CONSTRAINT email_create_time_not_null CHECK (create_time IS NOT NULL),
    CONSTRAINT email_email_not_null CHECK (email IS NOT NULL),
    CONSTRAINT email_id_not_null CHECK (id IS NOT NULL),
    CONSTRAINT email_is_pay_not_null CHECK (is_pay IS NOT NULL),
    CONSTRAINT email_password_hash_not_null CHECK (password_hash IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "user".edit_log (
    id bigint NOT NULL DEFAULT nextval('"user".edit_log_id_seq'::regclass),
    email varchar NOT NULL,
    edit_body text NOT NULL,
    create_time timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT edit_log_pkey PRIMARY KEY (id),
    CONSTRAINT edit_log_create_time_not_null CHECK (create_time IS NOT NULL),
    CONSTRAINT edit_log_edit_body_not_null CHECK (edit_body IS NOT NULL),
    CONSTRAINT edit_log_email_not_null CHECK (email IS NOT NULL),
    CONSTRAINT edit_log_id_not_null CHECK (id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "user".pv_uv (
    hour bigint NOT NULL,
    pv bigint NOT NULL,
    uv bigint NOT NULL,
    CONSTRAINT pk_pv_uv PRIMARY KEY (hour),
    CONSTRAINT pv_uv_hour_not_null CHECK (hour IS NOT NULL),
    CONSTRAINT pv_uv_pv_not_null CHECK (pv IS NOT NULL),
    CONSTRAINT pv_uv_uv_not_null CHECK (uv IS NOT NULL)
);

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'edit_log_cleanup',
  '0 3 * * *',
  $$DELETE FROM "user".edit_log
    WHERE create_time < now() - interval '7 days';$$
);
