-- User notifications.
--
-- Generic envelope: each row carries a `type` discriminator (e.g.
-- 'campaign_invitation') plus a JSON `payload` the front-end branches on
-- to render. `related_id` is an optional pointer back at the originating
-- entity (e.g. the campaign_invitations.id) so server code can mark
-- every notification tied to an invite as read when the invite is
-- accepted, rejected, or cancelled.

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(40) NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "related_id" uuid,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id");
--> statement-breakpoint
CREATE INDEX "notifications_related_idx" ON "notifications" ("related_id");
--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" ("read_at");
