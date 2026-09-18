/** Cheap coverage accounting for fleet-derived journeys; never executes site or provider code. */
export const FEATURE_CHECKS = Object.freeze({
  mail: ['interactions'],
  newsletter: ['interactions'],
  captcha: ['interactions'],
  tracking: ['interactions'],
  backend: ['backend-editor'],
  cache: ['runtime', 'interactions'],
  routes: ['http-dom', 'redirects'],
  content: ['schema', 'interactions'],
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);
const strings = value => Array.isArray(value) && value.length > 0
  && value.every(v => typeof v === 'string' && v.trim()) && new Set(value).size === value.length;
const artifact = value => object(value) && typeof value.path === 'string' && value.path.trim()
  && /^sha256:[a-f0-9]{64}$/.test(value.sha256);

export function featurePlanIssues(plan, runId) {
  if (!object(plan)) return ['feature plan must be an object'];
  const issues = [];
  if (plan.schema !== 'typo3-upgrade-run/feature-contracts@1' || plan.runId !== runId) issues.push('feature plan schema or run identity is wrong');
  if (!Array.isArray(plan.features) || !plan.features.every(object)) return [...issues, 'features must be an array of objects'];
  const ids = plan.features.map(f => f.id), expected = Object.keys(FEATURE_CHECKS);
  if (ids.length !== expected.length || new Set(ids).size !== ids.length || expected.some(id => !ids.includes(id))) {
    issues.push('feature applicability must cover every feature exactly once');
  }
  const journeys = new Set();
  for (const feature of plan.features) {
    const checks = Object.hasOwn(FEATURE_CHECKS, feature.id) ? FEATURE_CHECKS[feature.id] : null;
    if (!checks) { issues.push('unknown feature'); continue; }
    if (typeof feature.applicable !== 'boolean' || !artifact(feature.evidence)) issues.push(`${feature.id}: unresolved applicability or unhashed inventory evidence`);
    if (['backend', 'routes'].includes(feature.id) && feature.applicable !== true) issues.push(`${feature.id}: required on a whole-site upgrade`);
    if (!Array.isArray(feature.journeys) || !feature.journeys.every(object)) {
      issues.push(`${feature.id}: journeys must be an array of objects`); continue;
    }
    if (feature.applicable === true && !feature.journeys.length) issues.push(`${feature.id}: no planned journey`);
    if (feature.applicable === false && feature.journeys.length) issues.push(`${feature.id}: absent feature must not add work`);
    for (const journey of feature.journeys) {
      if (!identifier(journey.id) || journeys.has(journey.id)) issues.push('journey identity missing or duplicated');
      journeys.add(journey.id);
      if (!checks.includes(journey.check)) issues.push(`${feature.id}: journey routed to wrong closure check`);
      if (!strings(journey.assertions) || !journey.assertions.every(identifier)) issues.push(`${feature.id}: assertion IDs must be nonempty and unique`);
      if (!strings(journey.targets)) issues.push(`${feature.id}: representative targets missing or duplicated`);
    }
  }
  return issues;
}

export function featureCoverageIssues(plan, coverage, manifest) {
  const issues = featurePlanIssues(plan, manifest?.runId);
  if (issues.length) return issues;
  if (!object(coverage) || !Array.isArray(coverage.featureResults) || !coverage.featureResults.every(object)) {
    return ['featureResults must contain the executed journey evidence'];
  }
  const journeys = plan.features.flatMap(f => f.journeys), results = coverage.featureResults;
  const checks = Array.isArray(manifest?.checks) ? manifest.checks : [];
  const ids = new Set(journeys.map(j => j.id));
  if (results.length !== journeys.length || new Set(results.map(r => r.id)).size !== results.length
    || results.some(r => !ids.has(r.id))) issues.push('missing, duplicate or unplanned feature results');
  for (const journey of journeys) {
    const result = results.find(r => r.id === journey.id);
    if (!result) { issues.push(`${journey.id}: missing result`); continue; }
    const check = checks.find(c => c?.id === journey.check);
    if (!check || check.status !== 'pass' || check.exitCode !== 0
      || result.check !== journey.check || result.epoch !== check.epoch) issues.push(`${journey.id}: wrong, failed or stale parent check`);
    const assertions = result.assertions;
    if (!Array.isArray(assertions) || !assertions.every(object)
      || assertions.length !== journey.assertions.length
      || new Set(assertions.map(a => a.id)).size !== assertions.length
      || journey.assertions.some(id => !assertions.some(a => a.id === id && a.status === 'pass'))) {
      issues.push(`${journey.id}: missing, failed or skipped assertion`);
    }
    if (!Array.isArray(result.artifacts) || !result.artifacts.length || !Array.isArray(check?.artifacts)
      || result.artifacts.some(a => !artifact(a) || !check.artifacts.some(bound => bound?.path === a.path && bound?.sha256 === a.sha256))) {
      issues.push(`${journey.id}: artifacts must be bound to its final check`);
    }
  }
  return issues;
}
