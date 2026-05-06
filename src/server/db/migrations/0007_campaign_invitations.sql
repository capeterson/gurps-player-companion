-- Campaign invitations + manager role.
--
-- Adopts the gurps-player-web invitation flow: an inviter (owner or
-- manager) creates a pending invitation for a target user; the invitee
-- accepts (creating membership) or rejects.  Inviting at the manager
-- tier requires owner; managers can only invite at the member tier.
--
-- The new `manager` enum value is added to the existing campaign_role
-- type so existing memberships keep their values without rewrite.

ALTER TYPE "campaign_role" ADD VALUE IF NOT EXISTS 'manager';
--> statement-breakpoint

CREATE TYPE "campaign_invitation_status" AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');
--> statement-breakpoint

CREATE TABLE "campaign_invitations" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "inviter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "invitee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "campaign_role" NOT NULL,
  "status" "campaign_invitation_status" NOT NULL DEFAULT 'pending',
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revision" bigint NOT NULL DEFAULT nextval('revisions_seq')
);
--> statement-breakpoint

CREATE INDEX "campaign_invitations_campaign_idx" ON "campaign_invitations" ("campaign_id");
--> statement-breakpoint
CREATE INDEX "campaign_invitations_invitee_idx" ON "campaign_invitations" ("invitee_id");
--> statement-breakpoint
CREATE INDEX "campaign_invitations_status_idx" ON "campaign_invitations" ("status");
--> statement-breakpoint

-- Only ONE pending invitation may exist per (campaign, invitee) at a time.
-- Rejected/cancelled/accepted rows can coexist alongside a fresh pending one.
CREATE UNIQUE INDEX "campaign_invitations_one_pending_per_invitee"
  ON "campaign_invitations" ("campaign_id", "invitee_id")
  WHERE "status" = 'pending';
--> statement-breakpoint

-- Bump the shared revision on every UPDATE so cursor consumers stay
-- consistent with every other syncable row.
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_invitations"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
