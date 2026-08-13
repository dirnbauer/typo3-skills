/** Frontend evidence must come from a clean anonymous browser context. */

import { PreconditionError } from '../cli/exit-codes.mjs';

export const FRONTEND_CONTAMINATION_SELECTORS = Object.freeze([
  '#TSFE_ADMIN_PANEL_FORM',
  '#typo3-adminPanel',
  '.typo3-adminPanel',
  'typo3-admin-panel',
  '[data-typo3-admin-panel]',
  '.sf-toolbar',
  '[data-typo3-debug-toolbar]',
]);

export function contaminationReasons({ markers = [], cookieNames = [] } = {}) {
  const reasons = [];
  if (markers.length) reasons.push(`frontend debug/admin UI: ${markers.join(', ')}`);
  if (cookieNames.includes('be_typo_user')) reasons.push('backend session cookie: be_typo_user');
  return reasons;
}

export async function assertCleanFrontendSession(page) {
  const markers = await page.evaluate((selectors) => selectors.filter((selector) => {
    try { return document.querySelector(selector) !== null; }
    catch { return false; }
  }), FRONTEND_CONTAMINATION_SELECTORS);
  const cookieNames = (await page.context().cookies()).map((cookie) => cookie.name);
  const reasons = contaminationReasons({ markers, cookieNames });
  if (reasons.length) {
    throw new PreconditionError(
      `Frontend evidence is contaminated (${reasons.join('; ')}). Use a fresh isolated context `
      + 'with no selected-browser profile, TYPO3 backend session, Admin Panel or debug toolbar.',
    );
  }
  return { clean: true };
}
