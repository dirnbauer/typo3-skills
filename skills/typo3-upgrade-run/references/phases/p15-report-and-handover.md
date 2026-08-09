# P15 — Concise report and handover (no fix loop)

Track `report`.

## Preconditions
P13 closed. Any separately requested Contract B tracks are green or explicitly stopped.

## Steps
1. Update only README, Documentation, changelog, or operator instructions directly made inaccurate
   by the migration. Do not rewrite the documentation system as a completion prerequisite.
2. If Contract B ran, write its concise summary.
3. Generate the evidence summary, **including the run-statistics
   section**: loops run, iterations per loop, aborts and their triggers, self-test re-runs,
   wall-clock per phase, repaired against approved findings, and everything the run did not cover.
   Assemble it from `journal.jsonl` and the per-loop `report.json` files — a number nobody can
   trace back to a recorded entry does not belong in the report.
4. Write `report/handover-deployment.md` with only the commands, environment requirements,
   migrations, indexing needs and known gaps the deploying party actually needs.

## The handover is information only
This skill executes none of it. It lists: the Composer, schema, wizard, reference-index, language and
cache commands to repeat per environment; required PHP and database versions; configuration that
changes outside DDEV (base URLs, mail transport, proxies, headers, CSP) — hand this over as a
`.env.dist` key list where the project uses `helhum/dotenv-connector`, since that file is the
per-environment contract already written down, and name any credential that was rotated during the
run so the deploying party knows the old one is dead; reindexing needs such as
Solr; and every gap DDEV could not close — HSTS meaningfulness, production proxy headers, third-party
embeds absent locally.

For `deployer_information`, state whether standard Deployer metadata or custom `LAST_DEPLOY` is the
source of truth, who updates it, when it is updated, and how the first real deployment and rollback
will prove that the displayed timestamp is honest. Do not run those remote checks from this skill.

## Reports are assembled, not written
Every figure comes from `state.json` and the loop reports. A number in the KPI document that appears
nowhere in the evidence is a fabrication, however plausible it looks.

Recommendations are proposals for the user, not changes this skill made. Keep observations,
assumptions and recommendations visually separate.

## Exit
Contract A closure validates and the concise handover artifacts exist. Reporting never starts
another implementation loop.
