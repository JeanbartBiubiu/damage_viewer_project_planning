BEGIN;

CREATE SCHEMA analytics;

CREATE TABLE analytics.daily_visits (
    visit_date date NOT NULL,
    visitor_id uuid NOT NULL,
    pv bigint NOT NULL CHECK (pv > 0),
    PRIMARY KEY (visit_date, visitor_id)
);

COMMENT ON TABLE analytics.daily_visits IS '按北京时间自然日及匿名浏览器编号累计页面访问次数';
COMMENT ON COLUMN analytics.daily_visits.visitor_id IS '浏览器随机编号，不关联账号或来源地址';

COMMIT;
