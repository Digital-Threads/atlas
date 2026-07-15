CREATE TABLE analytics.order_events (
  event_id UUID,
  order_id UUID,
  event_name LowCardinality(String),
  created_at DateTime
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (order_id, created_at)
TTL created_at + INTERVAL 365 DAY;

CREATE MATERIALIZED VIEW analytics.order_events_daily
ENGINE = SummingMergeTree()
ORDER BY day
AS SELECT toDate(created_at) AS day, count() AS events
FROM analytics.order_events
GROUP BY day;

