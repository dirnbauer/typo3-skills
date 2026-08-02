import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../assets/schemas',
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: {
    'date-time': true,
    uri: true,
  },
});
const stateSchema = JSON.parse(await readFile(path.join(SCHEMA_DIR, 'state.schema.json'), 'utf8'));
const loopReportSchema = JSON.parse(await readFile(path.join(SCHEMA_DIR, 'loop-report.schema.json'), 'utf8'));
const loopDocSchema = JSON.parse(await readFile(path.join(SCHEMA_DIR, 'loop-doc-frontmatter.schema.json'), 'utf8'));
const validateStateSchema = ajv.compile(stateSchema);
const validateLoopReportSchema = ajv.compile(loopReportSchema);
const validateLoopDocSchema = ajv.compile(loopDocSchema);

export function stateSchemaErrors(state) {
  return validationErrors(validateStateSchema, state);
}

export function loopReportSchemaErrors(report) {
  return validationErrors(validateLoopReportSchema, report);
}

export function loopDocSchemaErrors(frontMatter) {
  return validationErrors(validateLoopDocSchema, frontMatter);
}

function validationErrors(validate, value) {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message}`
  ));
}
