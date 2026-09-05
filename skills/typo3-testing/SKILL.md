---
name: typo3-testing
description: "Use when setting up TYPO3 extension test infrastructure, writing unit/functional/E2E tests, configuring PHPUnit 11/12/13, mutation testing, mocking final classes (v14), CI/CD matrix across TYPO3 12/13/14.3 LTS, dev-dependency consolidation via typo3-ci-workflows meta-package, or debugging CI failures. Also triggers on: testing-framework setup, ensure proper testing, test matrix, integration testing, e2e testing, coverage, test generation."
---

# TYPO3 Testing Skill

## Assessment-First Rule

**When enhancing an existing test suite** (not from scratch), run FIRST:

```bash
automated-assessment typo3-testing
```

> Install `typo3-conformance` and `enterprise-readiness` for broader coverage.

Generates a gap report from 73+ checkpoints (PHPUnit, PHPStan, runTests.sh, architecture, mutation, CI matrix, coverage).

**Use the report as the task list.** Resolve mechanical failures before manual test writing.

### Applies
- "enhance/improve/strengthen tests", "increase coverage/mutation"
- "enterprise grade", "A+ testing"

### Does NOT Apply
- From scratch, writing a specific test, debugging a failure

---

## Test Type Selection

| Type | Use When | Speed |
|------|----------|-------|
| **Unit** | Pure logic, no DB, validators, utilities | Fast |
| **Functional** | DB interactions, repositories, controllers | Medium |
| **Architecture** | Layer constraints, dependency rules (phpat) | Fast |
| **E2E (Playwright)** | User workflows, browser, accessibility | Slow |
| **Integration** | HTTP client, API mocking, OAuth flows | Medium |
| **Mutation** | Test quality, 70%+ coverage | CI/Release |

## runTests.sh - Mandatory

`Build/Scripts/runTests.sh` is mandatory: executable, with `-s` (suite) and `-p` (PHP version).

## Git Hooks

Netresearch default: `Build/captainhook.json` (declared in composer.json `extra.captainhook.config`). Verify: `ls Build/captainhook.json .git/hooks/pre-commit` (see `references/captainhook-setup.md`).

## Commands

```bash
# Setup (from skill dir)
scripts/setup-testing.sh [--with-e2e]
scripts/validate-setup.sh
scripts/generate-test.sh <Type> <Class>

# Run (always via runTests.sh)
Build/Scripts/runTests.sh -s unit|functional|phpstan|cgl|mutation|ci
```

Verify tests fail before fix, pass after. Bug fixes use the strict TDD loop in `references/tdd-discipline.md` — no "tested/verified" claims without pasted output.

## Scoring Requirements

Unit tests required (70%+ coverage). Functional tests required for DB operations. **phpat required** for architecture points. PHPStan level 10.

## References (in `references/`, `.md` implied)

`unit-testing.md` | `functional-testing.md` | `functional-test-patterns.md` | `integration-testing.md` | `e2e-testing.md` | `accessibility-testing.md` | `ddev-testing.md` | `test-runners.md` | `architecture-testing.md` | `ci-debugging.md` | `ci-cd.md` | `quality-tools.md` | `mutation-testing.md` | `fuzz-testing.md` | `performance-testing.md` | `typo3-v14-final-classes.md` | `mock-validity.md` | `javascript-testing.md` | `captainhook-setup.md` | `enforcement-rules.md` | `event-dispatch-testing.md` | `crypto-testing.md` | `test-environment-guards.md` | `sonarcloud.md` | `typo3-ci-config-patterns.md` | `tdd-discipline.md` | `ci-workflows-meta-package.md` | `synthetic-secret-fixtures.md` | `release-workflow-validation.md` | `asset-templates-guide.md` | `backend-module-render-verification.md` | `backend-user-access-testing.md` | `framework-compat-gate.md`

### Content Triggers

- CI failures across TYPO3 versions → `ci-debugging.md`
- Functional tests with TSFE context → `functional-testing.md`
- Mock failures across dependency versions → `mock-validity.md`
- Image/extension tests, `Environment::initialize`, `NormalizedParams` TypeError, `backupGlobals` → `test-environment-guards.md`
- Event dispatcher testing with try/catch → `event-dispatch-testing.md`
- Meta-package, typo3-ci-workflows, no-plugins → `ci-workflows-meta-package.md`
- Fake secrets, push-protection, cs-fixer concat → `synthetic-secret-fixtures.md`
- Burned tag, validate before tagging → `release-workflow-validation.md`
- Backend module 500 / wrong ViewHelper namespace / runaway canvas → `backend-module-render-verification.md`
- Non-admin BE-user access enforcement → `backend-user-access-testing.md`
- Package will not install next to TYPO3 → `framework-compat-gate.md`

## Links

[TYPO3 Testing Docs](https://docs.typo3.org/m/typo3/reference-coreapi/main/en-us/Testing/) |
[Tea Extension](https://github.com/TYPO3BestPractices/tea) |
[phpat](https://github.com/carlosas/phpat) |
[Infection](https://infection.github.io/)
