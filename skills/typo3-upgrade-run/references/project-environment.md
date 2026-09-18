# Project environment, credentials and deployment visibility

Checked against upstream metadata and local v14 projects on 2026-09-05; resolve again at each run.
Apply [latest stable by default](latest-version-policy.md); the versions below are historical
compatibility evidence, not pins for loaders, deployment information or tooling.

## Credentials decision

- Prefer real environment injection plus Core `config/system/additional.php` for a new project.
  Read the expected names through `getenv()`/`$_ENV`/`$_SERVER` according to the actual loader;
  validate required values without printing them. Do not invent a second configuration framework.
- A root `.env` outside `public/` is acceptable local/deployment storage: mode 0600, Git ignored,
  excluded from artifacts, no plaintext secrets in `.env.example`/`.env.dist`. Preserve all existing
  keys and environment precedence. Ask for missing values through the approved secret mechanism.
- Existing `helhum/dotenv-connector` **3.2.0** is usable with verified v14 projects. It is a
  framework-independent Composer plugin, not a TYPO3 extension. Verify Composer plugin consent,
  PHP/Symfony compatibility and both CLI/web bootstrap. Do not replace a working connector merely
  to standardize. Its default loader can skip `.env` when `APP_ENV` already exists: test this path.
- `helhum/typo3-config-handling` is a different package. Published **2.1.0** allows Core
  `^12.4 || ^13.4`, not v14. Do not claim v14 support or install a fork implicitly. Migrate any
  actually used configuration to Core environment mapping, with value-equivalence tests.
- Without Helmut Hummel packages, use server/DDEV environment injection; if a file loader is
  required, choose a maintained `symfony/dotenv` release that resolves in the lockfile and initialize
  it once before configuration is read. No custom dotenv parser, regex interpolation, `eval`, or
  shell `source .env`. Dotenv files are data, not trusted shell code.

Use non-secret test values containing `$`, `#`, spaces and quotes to verify literal handling and
server-over-file precedence. Prove local DB/Mailpit endpoints remain local after imports. Never copy
production `.env` onto local settings wholesale. Do not expose credentials via `phpinfo`, CLI dumps,
browser traces, diff output or deployment archives. A discovered historical secret needs a separate
rotation finding; moving it into `.env` does not undo exposure.

## Required Deployer information

The package is **`spooner/deployer-information`**, extension key `deployer_information`, not the
Deployer CLI. Release **2.0.1** requires PHP `^8.2` and Core `^13.4 || ^14.3`. Include its compatible
stable release in the narrow planned Composer transaction. Verify package registration and the
System Information toolbar under the intended backend session. Local “no deployment yet” is valid;
inventing a timestamp is not. Standard Deployer metadata or an approved custom `LAST_DEPLOY` file
provides the timestamp. Never touch that file just to make the check look populated.

Update the existing Deployer CLI under that policy and review the migration guide for each crossed
major, including recipe/task names and shared files. Test the recipe locally. Exclude `.typo3-update`, auth state, screenshots,
traces, dumps and private env files from release archives. Deployment itself remains a separate task.

## Gate ownership

Intake inventories names/origins and missing packages without printing values. P05 performs the
scoped config/package work after Baseline A. P12 verifies CLI/web environment, frontend assets and
the backend toolbar. Record evidence in the `environment` and `deployer` closure checks.

Sources: [dotenv connector](https://packagist.org/packages/helhum/dotenv-connector),
[config handling](https://packagist.org/packages/helhum/typo3-config-handling),
[Deployer information](https://packagist.org/packages/spooner/deployer-information),
[Symfony Dotenv](https://github.com/symfony/dotenv).
