# GPC workflow skills and evals

The portable skills in `skills/` help agents combine GPC tools into player and GM
workflows. They use the connected client's actual tool names and advertised schemas.
Explicit requests to apply a fully specified change authorize that change; draft
requests remain read-only. Server permissions and validation still decide what can
be applied.

| Skill | Workflow | Eval coverage |
|---|---|---|
| `gpc-character-advancement` | Build characters and spend earned points | Budgeted advice, selected upgrade, private projection, required learned TL |
| `gpc-loadout` | Plan equipment and organize containers | Weight advice, selected packing, container cycle, lost-response retry |
| `gpc-library-authoring` | Author campaign-approved definitions | Approved creation, paginated editions, unknown defaults, owner permissions |
| `gpc-session-wrap-up` | Record logs, awards, and assigned loot | Private notes and award subsets, award revision, draft, partial rejection |
| `gpc-encounter-prep` | Prepare rosters and timed effects | Hidden NPC and duration, missing stats, role restrictions, turn conflict |

Each folder contains `SKILL.md`, optional client display metadata in
`agents/openai.yaml`, and four synthetic scenarios in `evals/evals.json`.
Copy the selected skill folders into the target client's supported plugin skill
directory and package them with its GPC MCP connection. Follow that client's plugin
format; this repository does not contain private connection registrations or a
universal install manifest. The skills can run with the current tool catalog.
Focused item/library cards are optional when advertised by the connected server.

## Run the checks

Bun runs inside the worktree's isolated Docker environment:

```sh
./scripts/dev-worktree.sh run --rm --no-deps app bun run skills:check
./scripts/dev-worktree.sh run --rm --no-deps app bun run skills:eval list
./scripts/dev-worktree.sh run --rm --no-deps app bun run skills:eval prepare .local/skill-evals/inputs
./scripts/dev-worktree.sh run --rm --no-deps app bun run skills:eval grade .local/skill-evals/traces.json
```

`skills:check` validates every case against the emitted MCP catalog and runs grader
regressions. It runs in CI and `bun run check`; it requires no model credentials or
live service. A passing check proves the corpus and grader are usable, not that an
agent follows the skills.

## Evaluate agent behavior

Give an independent agent the relevant `SKILL.md` and prepared input for each case.
Do not provide the source rubrics, prior answers, grader, or expected trace. The
prepared files omit the `checks` field and include the prompt, available tool
schemas, synthetic response projections, and trace format. Paths generated inside
Docker start with `/app`; resolve them relative to the checkout when evaluating on
the host. Evaluators simulate calls against these responses and never call a live
GPC account.

Record one trace per case in a JSON array:

```json
[
  {
    "caseId": "loadout-cycle",
    "calls": [],
    "proposals": [],
    "outcome": "blocked",
    "facts": {},
    "answer": "The pack cannot go inside its own nested pouch."
  }
]
```

This shows the trace shape only; an evaluator records the reads needed to establish
its conclusion. Calls contain `tool`, full `arguments`, and the supplied response's
`reply` ID. Proposals contain `tool` and full `arguments` for unexecuted changes.
Outcomes are `proposed`, `applied`, `blocked`, `needs_info`, or `partial`. Facts record
observable values requested by the prepared input. Replies omit unrelated fields;
omitted data is unspecified. A reply's `requires` IDs identify observations that
must precede its use, such as a creation acknowledgement before its read-back.

The grader validates real tool arguments, observation dependencies, mutation scope,
budgets, explicit recipients, private data placement, retry identity, and completion
claims. Missing or duplicate traces fail the run. Review the generated answers as
well: the automatic checks do not judge all narrative accuracy, usefulness, or
privacy in free text. Synthetic response traces do not replace the server's real
REST/MCP parity and authorization integration tests.

Keep model traces, reports, and one-off control artifacts under ignored `.local/`.
Only reusable synthetic cases and grader regressions belong in source control.
