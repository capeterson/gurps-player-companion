-- This records an insert attempt, not a commit: PostgreSQL logs survive rollback.
-- Only the synthetic queue UUID and bounded kind leave the database.
CREATE OR REPLACE FUNCTION log_email_queue_attempt() RETURNS trigger AS $$
BEGIN
  RAISE WARNING 'sunbolt_trigger %', json_build_object(
    'event', 'email.queue.insert_attempt',
    'job_id', NEW.id,
    'kind', NEW.kind
  )::text;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET client_min_messages = 'error';
--> statement-breakpoint
DROP TRIGGER IF EXISTS log_email_queue_attempt_trg ON notification_email_queue;
CREATE TRIGGER log_email_queue_attempt_trg
AFTER INSERT ON notification_email_queue
FOR EACH ROW EXECUTE FUNCTION log_email_queue_attempt();
