// Execute the inspected source, not a rewritten navigation algorithm.
// Minimal DOM doubles: this is a unit probe, NOT browser/TYPO3 integration proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const [powermail, conditions] = process.argv.slice(2);
if (!powermail || !conditions) {
  throw new Error('Usage: node check-multistep.mjs /clone/powermail /clone/powermail_cond');
}
const element = (classes = []) => {
  const names = new Set(classes);
  const attributes = new Map();
  return {
    style: {display: ''},
    classList: {
      contains: key => names.has(key),
      add: key => names.add(key),
      remove: key => names.delete(key),
    },
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: key => attributes.get(key) ?? null,
    hasAttribute: key => attributes.has(key),
    removeAttribute: key => attributes.delete(key),
    addEventListener() {},
  };
};
const source = fs.readFileSync(path.join(powermail,
  'Resources/Private/Build/JavaScript/MoreStepForm.js'), 'utf8');
const context = vm.createContext({
  Utility: {
    hideElement: el => { el.style.display = 'none'; },
    showElement: el => { el.style.display = 'block'; },
  },
});
vm.runInContext(source.replace(/^import .*;\r?\n/m, '')
  .replace('export default function', 'function') +
  '\nglobalThis.Navigation = MoreStepForm;', context);
const steps = [element(), element(['powermail-cond-hidden']), element(), element()];
const form = element(['powermail_morestep']);
form.querySelectorAll = selector => selector === '.powermail_fieldset' ? steps : [];
const navigation = new context.Navigation();
navigation.showFieldset(1, form, false);
assert.equal(steps[2].style.display, 'block', 'forward skips one hidden step');
navigation.showFieldset(1, form, true);
assert.equal(steps[0].style.display, 'block', 'backward skips one hidden step');
steps[2].classList.add('powermail-cond-hidden');
navigation.showFieldset(1, form, false);
const consecutiveHiddenIsShown = steps[2].style.display === 'block';

const target = element();
target.setAttribute('required', 'required');
const wrapper = element();
const page = element();
const toggle = element();
const conditionForm = element(['powermail_morestep']);
conditionForm.setAttribute('data-powermail-ajax', 'true');
conditionForm.setAttribute('data-validate', 'html5');
conditionForm.querySelectorAll = selector =>
  selector === '.powermail_fieldset' ? [page] : [];
conditionForm.querySelector = selector => {
  if (selector === 'input.powermail_form_uid') return {value: '1'};
  if (selector === '.powermail_fieldset_2') return page;
  if (selector === '.powermail_fieldwrap_details') return wrapper;
  if (selector.startsWith('.btn[')) return toggle;
  if (selector.startsWith('[name=')) return target;
  return null;
};
let action = 'hide';
const conditionContext = vm.createContext({
  window: {addEventListener() {}, getComputedStyle: () => ({visibility: 'visible'})},
  document: {querySelector: () => ({textContent: JSON.stringify({
    todo: {1: {2: {'#action': action, details: {'#action': action}}}},
  })})},
  console,
});
const conditionSource = fs.readFileSync(path.join(conditions,
  'Resources/Public/JavaScript/PowermailCondition.js'), 'utf8');
vm.runInContext(conditionSource + '\nglobalThis.Conditions = PowermailCondition;', conditionContext);
new conditionContext.Conditions(conditionForm).initialize();
assert.ok(page.classList.contains('powermail-cond-hidden'));
assert.equal(toggle.style.display, 'none');
assert.ok(target.hasAttribute('disabled'));
assert.ok(!target.hasAttribute('required'));
action = 'un_hide';
new conditionContext.Conditions(conditionForm).initialize();
assert.ok(!page.classList.contains('powermail-cond-hidden'));
assert.equal(toggle.style.display, '');
assert.ok(!target.hasAttribute('disabled'));
assert.ok(target.hasAttribute('required'));
console.log(JSON.stringify({
  passed: ['forward single-hidden step', 'backward single-hidden step',
    'conditional step control', 'disabled/required hide and restore'],
  limitations: consecutiveHiddenIsShown
    ? ['Consecutive hidden steps: navigation shows the adjacent hidden step.']
    : [],
  coverage: 'Source-level unit probe with DOM doubles; no TYPO3, browser, AJAX or mail runtime.',
}, null, 2));
