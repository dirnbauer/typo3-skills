/**
 * Declared changes — approved difference classes (rule 30, step 4).
 *
 * A TYPO3 core upgrade changes some output on purpose: a new default security header, a
 * modernised charset tag, a core error template. Restoring such output can be impossible or
 * wrong, so the user may approve the difference class instead. The run records each approved
 * class as a rule in `decisions/declared-changes.json`; the HTTP and DOM stages classify a
 * finding as `declared-change` only when approved rules explain ALL of its differences.
 * Anything a rule does not explain stays a `regression`.
 *
 * Rules never touch the sealed baseline or the capture: they are applied to an in-memory copy
 * of the normalised BEFORE document (DOM) or matched against a recorded difference (HTTP), and
 * every finding lists the rules it relied on. Pixels can be declared only by a URL-scoped whole_document
 * rule, which approves one page as a whole (see wholeDocumentRuleFor).
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { sha256 } from '../run/paths.mjs';
import { RULES as DOM_RULES } from './dom-normalize.mjs';

export const DECLARED_CHANGES_SCHEMA = 'typo3-upgrade-run/declared-changes@1';
export const DECLARED_CHANGES_FILE = path.join('decisions', 'declared-changes.json');
const STAGES = Object.freeze(['http', 'dom']);
const ID = /^DC-\d{3}$/;
const APPROVAL = /^APR-\d{3}$/;

/**
 * Reads and validates the run's declared changes. A rule whose approval is missing, not
 * granted by the user, or unknown to state.json is dropped and reported, so an unapproved
 * rule can never turn a regression into a declared change.
 */
export async function loadDeclaredChanges(paths, state) {
  const file = path.join(paths.root, DECLARED_CHANGES_FILE);
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { rules: [], hash: null, issues: [] };
    throw error;
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (error) { return { rules: [], hash: `sha256:${sha256(raw)}`, issues: [`declared changes are not JSON: ${error.message}`] }; }
  const approvals = await grantedApprovals(paths, state);
  const { rules, issues } = validateDeclaredChanges(doc, approvals);
  return { rules, hash: `sha256:${sha256(raw)}`, issues };
}

/** The evidence-input hash of the declared changes file, or null when the run has none. */
export async function declaredChangesHash(root) {
  try { return `sha256:${sha256(await readFile(path.join(root, DECLARED_CHANGES_FILE)))}`; }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * The DOM normaliser writes placeholders such as `<H>` (asset hash) or `<T>` (token) into URLs and
 * attribute values. A rule written as `<link [^>]+>` stops at the `>` of the first placeholder and
 * silently matches nothing wherever a URL carries one. In DOM `before` patterns the in-tag classes
 * `[^>]` and `[^<>]` therefore also accept one whole placeholder, taken from the normaliser's rules.
 */
const PLACEHOLDER = `(?:${[...new Set(DOM_RULES.flatMap((rule) => rule.to.match(/<[A-Z]+>/g) ?? []))].join('|')})`;

export function placeholderTolerant(pattern) {
  return pattern.replace(/(?<!\\)\[\^(<?)>\]/g, (_, lt) => `(?:${PLACEHOLDER}|[^${lt}>])`);
}

/** Pure validation: returns the usable rules and one issue per refused rule. */
export function validateDeclaredChanges(doc, grantedIds) {
  const issues = [];
  if (doc?.schema !== DECLARED_CHANGES_SCHEMA || !Array.isArray(doc.changes)) {
    return { rules: [], issues: [`declared changes need schema ${DECLARED_CHANGES_SCHEMA} and a changes array`] };
  }
  const rules = [];
  const seen = new Set();
  for (const [i, change] of doc.changes.entries()) {
    const label = change?.id ?? `changes[${i}]`;
    const problems = [];
    if (!ID.test(change?.id ?? '')) problems.push('id must look like DC-001');
    else if (seen.has(change.id)) problems.push('id is duplicated');
    if (!APPROVAL.test(change?.approval_ref ?? '')) problems.push('approval_ref must look like APR-001');
    else if (!grantedIds.has(change.approval_ref)) problems.push(`approval ${change.approval_ref} is not a granted user approval of this run`);
    if (!STAGES.includes(change?.stage)) problems.push(`stage must be one of ${STAGES.join(', ')}`);
    if (typeof change?.reason !== 'string' || change.reason.trim().length < 12) problems.push('reason must explain the change');
    if (change?.stage === 'http' && (typeof change.field !== 'string' || !change.field)) problems.push('http rules need a field');
    const wholeDocument = change?.stage === 'dom' && change?.whole_document === true;
    if (wholeDocument && typeof change?.url !== 'string') problems.push('whole_document rules must be scoped with url');
    if (change?.stage === 'dom' && !wholeDocument && typeof change.after !== 'string') problems.push('dom rules need an after replacement string');
    const beforePattern = change?.stage === 'dom' && typeof change?.before === 'string'
      ? placeholderTolerant(change.before) : change?.before;
    const before = wholeDocument ? null : compile(beforePattern, problems, 'before');
    const after = change?.stage === 'http' ? compile(change?.after, problems, 'after') : null;
    const url = change?.url === undefined ? null : compile(change.url, problems, 'url');
    if (problems.length) { issues.push(`${label}: ${problems.join('; ')}`); continue; }
    seen.add(change.id);
    rules.push({
      id: change.id, approval_ref: change.approval_ref, stage: change.stage, reason: change.reason,
      field: change.field ?? null, before, after, replacement: change.stage === 'dom' && !wholeDocument ? change.after : null, url,
      wholeDocument,
    });
  }
  return { rules, issues };
}

function compile(pattern, problems, name) {
  if (typeof pattern !== 'string' || !pattern) { problems.push(`${name} must be a non-empty regular expression`); return null; }
  try { return new RegExp(pattern, 'g'); }
  catch (error) { problems.push(`${name} is not a valid regular expression: ${error.message}`); return null; }
}

async function grantedApprovals(paths, state) {
  const known = new Set(state?.approvals ?? []);
  const granted = new Set();
  const files = await readdir(paths.approvalsDir).catch(() => []);
  for (const file of files) {
    const id = file.match(/^(APR-\d{3})-(?:intent|acceptance)-.*\.md$/)?.[1];
    if (!id || !known.has(id)) continue;
    const body = await readFile(path.join(paths.approvalsDir, file), 'utf8');
    const front = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!front) continue;
    const meta = parseYaml(front[1]);
    if (meta?.granted_by === 'user' && meta?.granted_at) granted.add(id);
  }
  return granted;
}

function applies(rule, url) {
  if (!rule.url) return true;
  rule.url.lastIndex = 0;
  return typeof url === 'string' && rule.url.test(url);
}

function matches(regex, value) {
  regex.lastIndex = 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return regex.test(text);
}

/**
 * Splits HTTP differences into the ones an approved rule explains and the rest.
 * A difference is explained only when field, before and after all match one rule.
 */
export function splitHttpDifferences(differences, rules, url) {
  const declared = [];
  const residual = [];
  for (const difference of differences) {
    const rule = rules.find((r) => r.stage === 'http' && r.field === difference.field && applies(r, url)
      && matches(r.before, difference.before) && matches(r.after, difference.after));
    if (rule) declared.push({ ...difference, declared_change: rule.id, approval_ref: rule.approval_ref });
    else residual.push(difference);
  }
  return { declared, residual };
}

/**
 * Rewrites the normalised BEFORE document with every applicable DOM rule. Returns the text
 * and the rules that actually changed it; a rule that matched nothing is not cited.
 * A URL-scoped whole_document rule (for example a core error template on a page that was
 * already broken before the upgrade) declares every difference of that one document.
 */
export function applyDomRules(normalizedBefore, rules, url, normalizedAfter = null) {
  let text = normalizedBefore;
  const applied = [];
  const whole = rules.find((rule) => rule.stage === 'dom' && rule.wholeDocument && applies(rule, url));
  if (whole) return { text, applied: [whole], wholeDocument: whole };
  for (const rule of rules) {
    if (rule.stage !== 'dom' || rule.wholeDocument || !applies(rule, url)) continue;
    // A rule declares that the old form was REPLACED. Where the new document still carries
    // the old form (a page that keeps its twitter:card), rewriting BEFORE would invent a
    // difference, so the rule does not apply to that document.
    rule.before.lastIndex = 0;
    if (normalizedAfter !== null && rule.before.test(normalizedAfter)) continue;
    rule.before.lastIndex = 0;
    const next = text.replace(rule.before, rule.replacement);
    if (next !== text) applied.push(rule);
    text = next;
  }
  return { text, applied };
}

/**
 * The approved whole_document rule that covers a page, if any. A whole-document declaration
 * approves the page as changed, so it also declares that page's screenshots; no other rule
 * can declare pixels.
 */
export function wholeDocumentRuleFor(rules, url) {
  if (typeof url !== 'string') return null;
  return rules.find((rule) => rule.stage === 'dom' && rule.wholeDocument && applies(rule, url)) ?? null;
}

/** The finding fields a declared-change classification adds. */
export function declaredFields(applied) {
  const refs = [...new Set(applied.map((rule) => rule.approval_ref))];
  return {
    approval_ref: refs.join(', '),
    declared_changes: applied.map((rule) => ({ id: rule.id, approval_ref: rule.approval_ref })),
  };
}
