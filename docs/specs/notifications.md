# Notifications

The header bell is an online-only, account-scoped inbox. It polls every 30
seconds and on window focus. Notifications are not a Dexie/outbox class. Reads,
mark-read, mark-all-read and dismissal retain their REST/MCP operations.

Settings screenshots: [desktop](../screenshots/notifications/notification-settings-desktop.png)
and [mobile](../screenshots/notifications/notification-settings-mobile.png).

## Topics and recipients

Settings → Notifications offers seven account-synced inbox topic switches,
all initially enabled:

| Topic | Events and audience |
|---|---|
| Invitations | Invitee receives an actionable campaign invitation; original inviter receives acceptance/decline. |
| Membership and access | Affected users receive direct additions, role changes, removals, ownership transfers and campaign deletion. |
| Changes to my characters | Character owner receives another user's changes to the character and its traits, skills, spells, languages, techniques, inventory or combat state, including deletion. Own-user edits do not notify. |
| Points awards | Another user's changes to a character's earned points notify its owner, including adjustments and reversals. These do not also create a generic character edit notice. |
| Campaign rules and settings | Other current campaign participants receive changes to house rules, point/disadvantage/quirk limits, mana/TL, attribute caps, sharing and GM editing. |
| Shared adventure log | Other current campaign participants receive newly published or newly shared log entries. Private entries generate no notice. |
| Linked library updates | Another user's changes to owned library mechanics/live links notify the affected character's owner. Pure mechanical propagation is separated from ordinary character edits. |

System/migration writes, own-user edits and revision/timestamp-only changes do
not notify. Inbox switches affect future event generation and are independent
of invitation email switches. Disabling a topic does not delete existing inbox
rows. Pending invitations remain accessible in the invitations inbox even if
invitation notifications are disabled.

Character notices group by actor, owner, character, topic and explicit gesture
batch ID; unbatched edits use 30-second time buckets. Grouped notices retain
category summaries; full changes remain in the authorized character history.
New changes after a group is read create a new unread notice. Root deletion
replaces any grouped edit summary and uses an unavailable target instead of a
broken character link. Campaign-only content is delivered only to participants
still authorized at delivery; targeted
access-loss notifications remain deliverable after membership disappears.

Reading a notification does not resolve its invitation. `actionable` on listed
notifications reflects the actual pending invitation state, independent of
`readAt`, so Mark all read leaves Accept/Decline available. Resolved/cancelled
invitations offer dismissal. Known types validate payloads; unknown/malformed
rows use generic fallback text rather than invitation wording. Text is rendered
as text, and event links are restricted to internal character/campaign paths.
The bounded bell panel wraps, scrolls and stays within the dynamic viewport.
The shared overlay helper measures its remaining height below the header,
including mobile headers that wrap onto another row and visual-viewport changes.

## Email policy

Only two optional email categories exist, both enabled by default and
independently toggleable:

- Campaign invitation → invitee.
- Invitation accepted → original sender.

Declines, character changes, membership/access changes, points, campaign rules,
logs and library topics have **no email delivery support**.
Password changes and passkey/API-key additions/removals/revocations generate
unconditional security email, with no preference to disable it. Credential
changes in one account transaction share one security alert; password recovery
therefore does not produce one email for every revoked credential. Requested
password recovery email remains a separate account-recovery flow.

Delivery requires configured Resend credentials and a sender, as before.
The transactional scalar email queue supports only `invitation`,
`invitation_accepted`, and `security`. The worker rechecks invitation preferences
and pending invitation state before delivery, drops suppressed/resolved jobs,
checks provider errors, and retries transient failures with backoff (at most
eight attempts). Event keys deduplicate queue insertion; provider idempotency
keys prevent duplicate delivery after an uncertain result. Exhausted jobs keep
their diagnostic status. No settings imply support for email on other topics.

## Desktop notifications

Desktop is off by default and stored per user on each browser. Existing browser
permission alone never enables it. Only an explicit Settings enable gesture may
call `Notification.requestPermission`; loading, signing in, opening the bell,
receiving notifications and syncing settings cannot request permission.
Denied/dismissed permission leaves delivery disabled; Settings explains blocked
or unsupported browsers. Failed changes produce a named toast and rollback
flash. Enabling another browser requires another explicit action.

Desktop delivery uses the same inbox topics, requires both the application
switch and granted browser permission, and displays only while the app page is
open in the background. It does not implement closed-app Web Push. The first
successful inbox fetch after enabling establishes a baseline, preventing old
unread notices from replaying. Browser-local delivery IDs and Web Locks prevent
repeat delivery across tabs/reloads; absent durable storage or Web Locks,
delivery fails closed. Active foreground pages use the bell without OS alerts.
Previews omit character values and log content; clicking opens the internal
target where ordinary access checks still apply.

## Capture and processing

Migration 0063 adds `users.notification_preferences` (validated by
`notificationPreferences`), a notification grouping key, and two durable queues.
An AFTER INSERT trigger on `entity_history` queues only new eligible audit
records in the originating transaction, snapshotting recipient IDs and the explicit
gesture ID separately from sync's per-operation audit fallback. This sits
below REST, sync and MCP and cannot emit rejected/rolled-back writes. There is
no historical backfill. Campaign membership deletion events preserve affected
recipients even when campaign deletion cascades remove the campaign roster.

Invitation and credential triggers create scalar email jobs transactionally.
Acceptance/decline routes validate and emit the original sender's inbox notice
in their existing transaction. No SQL trigger writes a notification JSON payload.
The invitation creation route respects the invitee's inbox preference.
Workers claim rows with `FOR UPDATE SKIP LOCKED`; inbox fan-out and queue
consumption commit together. Advisory locks serialize updates to a grouped
notice across workers. Migration 0069 adds queue triggers that issue an empty
`NOTIFY gpc_notification_queue` on history inserts and eligible email inserts or
retry-deadline updates. Postgres delivers these wakeups after commit; no character
data or email content travels on the channel.

The same Bun process holds a dedicated `pg.Client` session on `DATABASE_URL` and
commits `LISTEN` before scanning the durable backlog, both on startup and after
reconnecting. That URL must support session state (direct Postgres or session
pooling, not transaction pooling). Wakeups coalesce during active processing;
the worker drains bounded history/email batches until caught up without waiting
between batches. An empty queue schedules no processing timer. Pending email
retries schedule a timer for their earliest eligible `next_attempt_at`; delivery
without configured credentials schedules no email timer. Committed history rows
still locked by another worker retain a short retry timer: that worker's rollback
or exit releases the work without producing a new insertion wakeup. Already-due
mail locked by another worker also gets a bounded delay to avoid spinning. Listener reconnection
and processing failures retry with exponential backoff capped at one minute.
Automatic maintenance remains disabled in ordinary tests. Shutdown cancels timers,
closes the listener session and waits for active processing to finish.

`GET/PATCH /auth/notification-preferences` accepts interactive active JWT
sessions only; MCP/API keys cannot change browser notification policy. PATCH
locks the user row and merges only validated fields, so concurrent independent
settings changes cannot overwrite one another. These exact operations have
explicit MCP infrastructure exclusions. Inbox topic/email toggles reuse
`useDraftToggle` to queue rapid same-field edits and show toast+flash on failure;
client cache merges only the confirmed field so out-of-order responses cannot
clobber a different toggle.

## File map

- `src/shared/schemas/notification.ts` — invitation, generic event and mail payloads.
- `src/shared/schemas/notificationPreferences.ts` — account defaults, patches and topic labels.
- `src/server/routes/notificationPreferences.ts` — interactive settings endpoints.
- `src/server/services/notificationEvents.ts` — audited-event classification/fan-out/grouping.
- `src/server/services/notificationEmails.ts` — bounded mail delivery.
- `src/server/services/notificationMaintenance.ts` — same-process maintenance lifecycle.
- `src/client/features/settings/NotificationsSection.tsx` — desktop, email and inbox controls.
- `src/client/lib/desktopNotifications.ts` — explicit permission, device opt-in and delivery deduplication.
- `src/client/components/NotificationsBell.tsx` — typed inbox rendering and invitation actions.
