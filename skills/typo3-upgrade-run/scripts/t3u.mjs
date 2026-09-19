#!/usr/bin/env node
/**
 * t3u — TYPO3 update evidence-graph orchestrator and equality prover.
 *
 * One entrypoint, subcommands, and exactly one place that decides the exit code
 * (lib/cli/command.mjs). That structure is the fix for the v1 defect where three actions
 * could report forty differing screenshots and still exit 0.
 *
 *   0 pass · 1 findings · 2 harness error · 3 invalid · 4 precondition · 5 blocked by policy
 */

import { parse, helpText } from './lib/cli/args.mjs';
import { runCommand } from './lib/cli/command.mjs';
import { EXIT } from './lib/cli/exit-codes.mjs';
import { init, runtimeSeal, doctor, status, envFingerprint, contentFingerprint } from './lib/actions/core.mjs';
import { discoverUrls } from './lib/actions/discover.mjs';
import { capture } from './lib/actions/capture.mjs';
import {
  compareHttp, compareDomAction, compareVisual, compareAll,
  selftestDeterminism, sealBaselineAction, verifyBaselineAction, gate,
} from './lib/actions/compare.mjs';
import { backendSweep, smoke, lighthouse, axeAudit } from './lib/actions/sweep.mjs';
import { report } from './lib/actions/report.mjs';
import { closureStart, closureCheck, closureVerify } from './lib/actions/closure.mjs';
import { resourceRun } from './lib/actions/resource-run.mjs';
import {
  approvalRecord,
  loopOpen,
  loopStart,
  snapshotCreate,
  validateRun,
} from './lib/actions/lifecycle.mjs';
import {
  graphInit, graphNext, graphStatus, graphValidate, graphForecast, nodeClose, nodeOpen,
} from './lib/actions/graph.mjs';

const ACTIONS = {
  'resource-run': resourceRun,
  init,
  'runtime-seal': runtimeSeal,
  doctor,
  status,
  'graph-init': graphInit,
  'graph-status': graphStatus,
  'graph-next': graphNext,
  'graph-validate': graphValidate,
  'graph-forecast': graphForecast,
  'node-open': nodeOpen,
  'node-close': nodeClose,
  'validate-run': validateRun,
  'closure-start': closureStart,
  'closure-check': closureCheck,
  'closure-verify': closureVerify,
  'loop-start': loopStart,
  'loop-open': loopOpen,
  'snapshot-create': snapshotCreate,
  approval: approvalRecord,
  'env-fingerprint': envFingerprint,
  'content-fingerprint': contentFingerprint,
  'discover-urls': discoverUrls,
  capture,
  'selftest-determinism': selftestDeterminism,
  'seal-baseline': sealBaselineAction,
  'verify-baseline': verifyBaselineAction,
  'compare-http': compareHttp,
  'compare-dom': compareDomAction,
  'compare-visual': compareVisual,
  'compare-all': compareAll,
  'backend-sweep': backendSweep,
  smoke,
  lighthouse,
  axe: axeAudit,
  gate,
  report,
};

async function main(argv) {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return err.exitCode ?? EXIT.HARNESS_ERROR;
  }

  if (parsed.command === 'help' || parsed.values?.help) {
    process.stdout.write(helpText(parsed.positionals?.[0] ?? parsed.command === 'help' ? parsed.positionals?.[0] : parsed.command));
    return EXIT.PASS;
  }

  return runCommand({ ...parsed, argv, actions: ACTIONS });
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
