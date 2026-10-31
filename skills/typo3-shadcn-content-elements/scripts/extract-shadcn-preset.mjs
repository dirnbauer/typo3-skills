#!/usr/bin/env node
/**
 * Extract a shadcn/create preset from a scratch app into a scoped CSS block for TYPO3.
 *
 * Reads the scratch app's components.json (style, tailwind.baseColor, iconLibrary, menuColor,
 * menuAccent) and its Tailwind source CSS, copies the top-level `:root { … }` and `.dark { … }`
 * token blocks plus the font `@import` lines, and writes them scoped to
 * `body[data-shadcn-preset="<id>"]` and `.dark body[data-shadcn-preset="<id>"]`.
 *
 * Usage:
 *   node extract-shadcn-preset.mjs --scratch <dir> --preset <id> [--css <file>] \
 *        [--out <file.css>] [--meta <file.json>]
 *
 *   --scratch  the app `npx shadcn@latest create --preset <id> …` generated
 *   --preset   the preset id, used as the data attribute value and in the header comment
 *   --css      the Tailwind source CSS; default: components.json `tailwind.css`, then the usual
 *              template paths (src/index.css, src/styles/global.css, src/app/globals.css,
 *              app/globals.css)
 *   --out      write the scoped CSS here instead of stdout
 *   --meta     also write a JSON record of the preset metadata and extraction counts
 *
 * Exit codes: 0 written, 1 usage error, 2 input missing or no `:root` block found.
 *
 * Node 18 or newer, no dependencies. Font variables are listed in a comment so the project can
 * map them to its own variables (`--d-font-sans` and friends); the script does not guess that.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';

const CSS_CANDIDATES = ['src/index.css', 'src/styles/global.css', 'src/app/globals.css', 'app/globals.css'];

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('usage: node extract-shadcn-preset.mjs --scratch <dir> --preset <id> [--css <file>] [--out <file>] [--meta <file>]');
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) usage(`unexpected argument ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) usage(`${key} needs a value`);
    args[key.slice(2)] = value;
    i += 1;
  }
  if (!args.scratch || !args.preset) usage('--scratch and --preset are required');
  if (!/^[A-Za-z0-9_-]+$/.test(args.preset)) usage('--preset must be letters, digits, - or _');
  return args;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`error: cannot read ${path}: ${error.message}`);
    process.exit(2);
  }
}

function findCss(scratch, components, explicit) {
  const candidates = [];
  if (explicit) candidates.push(resolve(explicit));
  if (components?.tailwind?.css) candidates.push(join(scratch, components.tailwind.css));
  for (const relative of CSS_CANDIDATES) candidates.push(join(scratch, relative));
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    console.error(`error: no Tailwind source CSS found; tried:\n  ${candidates.join('\n  ')}`);
    process.exit(2);
  }
  return found;
}

/** Return the body of the first top-level block whose selector equals `selector`. */
function extractBlock(css, selector) {
  let depth = 0;
  let index = 0;
  while (index < css.length) {
    const char = css[index];
    if (char === '{') {
      if (depth === 0) {
        // the selector runs from the previous `}` or `;` (whichever is later) to this `{`
        const start = Math.max(css.lastIndexOf('}', index), css.lastIndexOf(';', index)) + 1;
        const head = css.slice(start, index).replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (head.split(/\s*,\s*/).includes(selector)) {
          const end = findClosingBrace(css, index);
          return css.slice(index + 1, end).trim();
        }
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }
    index += 1;
  }
  return null;
}

function findClosingBrace(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

function declarations(body) {
  return body
    .split(';')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('--'))
    .map((line) => `${line};`);
}

function fontImports(css) {
  return css
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('@import') && /font/i.test(line));
}

function fontVariables(css) {
  const matches = css.matchAll(/--font-[a-z0-9-]+\s*:\s*[^;]+;/g);
  return [...new Set([...matches].map((match) => match[0].trim()))];
}

function indent(lines) {
  return lines.map((line) => `  ${line}`).join('\n');
}

const args = parseArgs(process.argv.slice(2));
const scratch = resolve(args.scratch);
const componentsPath = join(scratch, 'components.json');
if (!existsSync(componentsPath)) {
  console.error(`error: ${componentsPath} not found; is --scratch the generated app?`);
  process.exit(2);
}
const components = readJson(componentsPath);
const cssPath = findCss(scratch, components, args.css);
const css = readFileSync(cssPath, 'utf8');

const root = extractBlock(css, ':root');
if (root === null) {
  console.error(`error: no top-level ":root { … }" block in ${cssPath}`);
  process.exit(2);
}
const dark = extractBlock(css, '.dark') ?? '';
const rootDeclarations = declarations(root);
const darkDeclarations = declarations(dark);
const imports = fontImports(css);
const fonts = fontVariables(css);

const meta = {
  preset: args.preset,
  style: components.style ?? null,
  baseColor: components.tailwind?.baseColor ?? null,
  iconLibrary: components.iconLibrary ?? null,
  menuColor: components.menuColor ?? null,
  menuAccent: components.menuAccent ?? null,
  cssSource: cssPath,
  rootVariableCount: rootDeclarations.length,
  darkVariableCount: darkDeclarations.length,
  fontImports: imports,
  fontVariables: fonts,
  extractedAt: new Date().toISOString().slice(0, 10),
};

const header = [
  `/* shadcn preset ${meta.preset}: style=${meta.style ?? '?'}, baseColor=${meta.baseColor ?? '?'},`,
  ` * iconLibrary=${meta.iconLibrary ?? '?'}, menuColor=${meta.menuColor ?? '?'}, menuAccent=${meta.menuAccent ?? '?'}.`,
  ` * Extracted ${meta.extractedAt} from ${components.tailwind?.css ?? cssPath} by extract-shadcn-preset.mjs. */`,
];
const fontNote = fonts.length
  ? ['/* Font variables found in the source; map them to the project variables (--d-font-sans, --d-font-heading, --d-font-mono): ', ...fonts.map((line) => ` *   ${line}`), ' */']
  : [];

const output = [
  ...header,
  ...imports,
  ...fontNote,
  `body[data-shadcn-preset="${meta.preset}"] {`,
  indent(rootDeclarations),
  '}',
  ...(darkDeclarations.length
    ? [`.dark body[data-shadcn-preset="${meta.preset}"] {`, indent(darkDeclarations), '}']
    : ['/* no top-level .dark block found; add dark tokens by hand */']),
  '',
].join('\n');

if (args.out) {
  writeFileSync(resolve(args.out), output);
  console.error(`wrote ${args.out}: ${rootDeclarations.length} light and ${darkDeclarations.length} dark variables`);
} else {
  process.stdout.write(output);
}
if (args.meta) {
  writeFileSync(resolve(args.meta), `${JSON.stringify(meta, null, 2)}\n`);
  console.error(`wrote ${args.meta}`);
}
if (!darkDeclarations.length) console.error('warning: no .dark block found');
