# Quality Bar

Continues `typo3-translations` from [full guide](full-guide.md).

## Quality Bar

- The XLIFF version and reference style follow the compatibility range as
  stated in the Core Rules of `SKILL.md`; the files do not mix the two.
- Source and target files stay structurally aligned.
- Keys are stable, namespaced, and readable.
- ICU strings keep placeholder names intact and use named runtime arguments.
- TYPO3 APIs resolve labels; no custom XML label loader is introduced.
- All changed files parse as XML and labels are smoke-tested after cache flush.
