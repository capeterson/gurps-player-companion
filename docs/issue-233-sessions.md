# Issue 233 implementation sessions

[Issue 233](https://github.com/capeterson/gurps-player-companion/issues/233) and the [implementation packets and architecture reviews](https://gist.github.com/capeterson/8da70e3e76700e7c796a0b9816cd5aa5) are the source for packet details, evidence, exact copy, and acceptance. This is an execution plan, not evidence that those proposals have shipped or that their visual designs are approved. Recheck the current issue and linked material before each packet.

Session 1 implements **PROP-043 only** in this change. All other sessions are planned. Previous unfinished work remains preserved; inspect relevant changes and their provenance selectively, and reuse only independently reviewed work that meets the current packet's contract. Do not assume existing edits or prior tests establish completion.

Each lettered row below is a separate execution session. The numbered groups organize related work; they are not a promise that the work fits a particular time or usage budget. Split further when necessary, preserving a reviewable checkpoint and the stated acceptance boundary. Dependencies refer to completed foundations, not merely started sessions.

| Session | Packet and bounded scope | Prerequisites and exit |
| --- | --- | --- |
| 1 | **043** Known campaign rule projection across reads and skill evaluation. | Implemented here. Exit requires sparse/defaulted and explicit values, unavailable context, authorization and REST/sync/MCP parity validation. |
| 2a | **001** Shared draft knowledge, rollback baseline and transactional comparison. | Verify no lost current intent, ordered writes, rejection feedback and read-failure behavior. |
| 2b | **001** Character and owned-row integration and browser races. | 2a; actual durable outcomes, toast and flash. Both parts required for closure. |
| 3 | **004** Stable domain identities and safe duplication. | Schema and reference integrity, reorder and reopen. |
| 4 | **003** Domain-aware reference choices and repair. | 004 interfaces; valid choices, unresolved references and open picker geometry. |
| 5 | **007** Actionable validation paths and host-specific bounds. | Named errors reveal and focus actual controls, including reordered and nested rows. |
| 6 | **005** Numeric drafts and library/character consumers. | 007; raw invalid values retained, correct bounds and no invalid writes. Encounter consumers are completed with 29 and 30; do not close 005 early. |
| 7a | **006** Union draft retention, replacement generations and optional semantics. | 004/005/007; preserve branch drafts and focus. |
| 7b | **006** Modifier, operation and category consumers. | 7a; supported operations, semantic round trips and responsive review. |
| 8 | **012** Specialized branch retention, research, ranges and effect preview. | 006; exact saved bodies, replacement and selector matching. |
| 9 | **011** Legacy mirror reconciliation. | Shared editor and all write doors preserve authored rules, history and revisions. |
| 10 | **002** Canonical armor and weapon facets. | 004 and coordinated 006; legacy/conflict fixtures, adoption and actual calculations. |
| 11 | **014** Race and lens legal kinds. | 003/004; preserve authored identities and validate real host forms. |
| 12a | **013** Executable semantic validation and legacy compatibility inventory. | 007; parity across write doors, staged imports and repair without destructive rewrites. |
| 12b | **013** Shared automatic input registry and context construction. | 12a; canonical identities, unavailable inputs and pure shared execution. |
| 12c | **013** Semantic input authoring and end-to-end acceptance. | 12b; real previews, diagnostics, legacy repair and responsive review. |
| 13 | **025** Reject normalized argument collisions without losing drafts. | 007 and coordinated 013; GUI and all write-door parity. |
| 14a | **026** Draft-derived calculation references and picker. | 013/025; preserve unresolved identifiers and keyboard/viewport behavior. |
| 14b | **026** Complete graph and calculation acceptance. | 14a; real saved graph, caller/callee behavior and expected evaluator results. |
| 15 | **008** Shared tooltip containment and reachability. | Real consumers, long content, keyboard, short viewports and screenshot inspection. |
| 16 | **009** Meaningful rules and linked contributors. | 008; exact mechanics, access and navigation to real destinations. |
| 17 | **010** Metadata alignment. | Existing component conventions; all-theme and keyboard review. |
| 18a | **027** Retained library authoring sessions and guards. | 001/006; filters, hidden mounted drafts, save generations and access transitions. |
| 18b | **027** Owned enchantment sessions and stable local tokens. | 18a contract; ambiguous replacement, transaction races and exact saved results. |
| 19 | **028** Table-paste preservation and bounded mapping probe. | Safe refusal when mapping is unproved; real clipboard and caller workflows. |
| 20 | **021** Compact authoring composition. | 002/004/006/027; all controls and private drafts survive layout changes, with real visual review. |
| 21 | **022**, **023** Category visibility and price/action collision. | Independent surfaces may have separate owners; actual viewport geometry and both-theme review for each. |
| 22 | **024** Import confirmation and count grammar. | Destructive consequences remain visible; modal geometry and zero/one/many cases. |
| 23 | **016** Whole-form snapshots and campaign-scoped log drafts. | Slow success, context changes and actual request targets; encounter extension is completed in 29. |
| 24 | **017**, **015** Invitation guard and campaign settings. | 016 for invitation; 007 for settings. Use separate owners only for disjoint files; verify independent requests, role gates and validation. |
| 25 | **018**, **019** Safe sign-in destinations and scoped history filters. | Independent surfaces; safe path validation and scope-specific filtering with browser coverage. |
| 26 | **020** Recovery and credential-read errors. | 007; correct recovery errors, no account enumeration and retryable credential reads. Coordinate 34 and 35. |
| 27 | **029** Recalculation from owned purchases. | 001/005/007/016; exact staged purchase, outbox result, downstream effects and dialog review. |
| 28a | **033** Manual trait levels and effects. | 029; actual contributions, paid points and queue/rollback behavior. |
| 28b | **032** Technique limits and notes. | 001/005/007/008/012/016; actual math, saved values and queue behavior. |
| 28c | **031** Spell casting details. | Same foundations as 28b; null/zero upkeep, real cast behavior and durable edits. |
| 28d | **030** Owned skill rules and policies. | 003/006/007/008/012/013/016; defaults, TL policy, resolver and queue acceptance. |
| 29 | **034** Encounter setup and roster; finish **016** encounter lifetime and **005** encounter numeric consumers. | 005/007/016; idempotent request lifetime, real roles, turn consistency and geometry. |
| 30 | **037** Local solo tracker correction and reset. | 001/005/007/016; schema coverage, character isolation, turn behavior and reset failure. Completes remaining 005 solo consumer. |
| 31a | **035** Actor-aware projections, response contracts and idempotency replay. | 001/007/016; privacy and access parity remain fail-closed. |
| 31b | **035** Dirty link edits and permission changes. | 31a; explicit clear and redaction never disclose or erase private links. |
| 31c | **035** Current PC status and invalidation. | 31a–b; owner/other roles, access loss, offline/reconnect and actual response bodies. |
| 32a | **036** Effect identity and explicit cleanup choices. | 001/004/007/016/035; visible identity and privacy-safe permissions. |
| 32b | **036** Durable receipt and atomic local outbox handoff. | 32a; uncertain requests, reload, account guard, retries and partial rejection. No distributed-transaction claim. |
| 33 | **038** Session-bound account-setting toggle queue. | Account replacement, same-session rotation, errors and navigation races. |
| 34 | **039**, **040** Password-reset work guard and independent media recovery. | 020/038 for reset; separate owners only on disjoint files. Verify session fencing and exact media recovery dependencies. |
| 35 | **041** Credential creation identity and resumable reauthentication. | 016/018/020/038; secret generation, passkey draft and deliberate same-account continuation. |
| 36a | **042** Bounded inbox paging and honest loading. | Stable behavior when new notifications arrive, older invitation actions and errors. |
| 36b | **042** Unread and desktop notification acceptance. | 36a; no stale replay or seen-state eviction; any new API count requires complete parity. |

## Session discipline

- Start from the current authorized baseline, inspect the working tree and follow the repository's current main, worktree, Compose and spec instructions. Read the relevant source, reproduction, living specs and required UI skills before editing. Assign shared files and interfaces before parallel work.
- Normally use one Terra agent at medium reasoning. Use at most two Terra agents only where ownership is genuinely disjoint; integrate shared interfaces, generated contracts, specs and migrations serially. The primary agent reviews and integrates. Luna can run tests, reproduce behavior and watch executions; test results still require review.
- Reserve roughly 40% of each session's available allowance for independent review, acceptance gates, fixes and a safe handoff. This is a planning target, not a usage guarantee. Once the bounded implementation is ready, do not begin the next packet. Stop after one PR; future sessions require an explicit new start.
- Compare this first session with the account's usage meter before starting another. Calibrate later scopes from observed consumption; combine planned slices only after checking their dependencies, file ownership and remaining allowance.
- Each session exits with a coherent, reviewable checkpoint, relevant current-state spec changes, and the packet's applicable acceptance evidence. Include real durable outcomes, queue/rejection/cursor cases and authorization or API/MCP parity as relevant. UI changes require real browser workflows and independent responsive/overlay image and geometry review where applicable.
- A code PR requires the applicable complete local parity and pre-PR gates, including the mandatory Lantern MCP seed acceptance. Focused tests and source review do not replace those gates. Run database integration and OAuth/MCP browser work serially when they share state.
- Stop and document the unresolved boundary if evidence, architecture, compatibility, privacy, or required validation cannot be established within the session. Do not silently weaken acceptance, discard unrelated edits, automatically start another session, or claim completion from a prototype or audit finding alone.
