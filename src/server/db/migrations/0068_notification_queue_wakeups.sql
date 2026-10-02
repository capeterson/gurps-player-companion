-- Wakeups carry no user data. Postgres delivers them only after the queue write
-- commits, coalescing repeated signals on this channel within one transaction.
CREATE OR REPLACE FUNCTION wake_notification_worker() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('gpc_notification_queue', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS wake_notification_worker_trg ON notification_history_queue;
CREATE TRIGGER wake_notification_worker_trg AFTER INSERT ON notification_history_queue
  FOR EACH ROW EXECUTE FUNCTION wake_notification_worker();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wake_notification_worker_trg ON notification_email_queue;
CREATE TRIGGER wake_notification_worker_trg AFTER INSERT OR UPDATE OF next_attempt_at ON notification_email_queue
  FOR EACH ROW WHEN (NEW.sent_at IS NULL AND NEW.attempts < 8)
  EXECUTE FUNCTION wake_notification_worker();
