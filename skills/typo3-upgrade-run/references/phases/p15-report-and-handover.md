# P15 — Report and handover (loop 900)

Track `report`.

## Preconditions
P13 closed. All approved Contract B tracks green or explicitly stopped.

## Steps
1. Rewrite `README.md` as a concise entry point: purpose, features, TYPO3/PHP requirements,
   installation, quick start, configuration, workspace behaviour, testing, limitations, links.
2. Update `Documentation/` per TYPO3 conventions with a v12/v13-to-v14 upgrade guide, migration
   commands, data upgrade steps, breaking changes and removed features.
3. Add a `CHANGELOG.md` entry: the 14.3-only requirement, dropped versions, dependency changes,
   workspace support, migrations. **Do not invent a release date or tag.**
4. Write `report/contract-b-summary.md`.
5. Generate the KPI document per `references/kpi-report.md`, **including the run-statistics
   section**: loops run, iterations per loop, aborts and their triggers, self-test re-runs,
   wall-clock per phase, repaired against approved findings, and everything the run did not cover.
   Assemble it from `journal.jsonl` and the per-loop `report.json` files — a number nobody can
   trace back to a recorded entry does not belong in the report.
6. Write `report/handover-deployment.md` using `references/deployment-handover.md`, including the
   audited Deployer recipe and `EXT:deployer_information` mode/version/first-real-deploy checks.

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
`gate-check --group ALL` exits 0.
