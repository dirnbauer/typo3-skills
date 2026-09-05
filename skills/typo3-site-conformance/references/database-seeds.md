# Database seeds with fixed uids

Demo and project repos often ship a `data/*.sql` seed that creates pages and
content elements at **hard-coded uids** so the rest of the repo — site config,
TypoScript, dashboard cards — can reference them. Three properties decide whether
that seed stays correct after the first deploy. All three were measured against
MariaDB 12 on a live TYPO3 v14.3 instance; each had already caused a production
defect before it was understood.

## 1. `INSERT IGNORE` fails silently, in two directions

`INSERT IGNORE` skips a row whose uid is already taken **and** never updates an
existing row. Both are silent: the import returns 0, the deploy reports success,
and the page is either absent or frozen at whatever an earlier run wrote.

One instance lost three deploy cycles to this — a page missing because an editor
had taken its uid, then the same page rendering empty because its content
elements stayed on the abandoned uid, then a content element stuck at a 554-byte
body while the seed said 4386.

Make the seed **re-assert** its intended state and **fail loudly** when it cannot:

- Keep a manifest of every seeded record in a temporary table, and drive one
  `UPDATE … JOIN` per table from it. One place states the intent; the same
  manifest drives verification.
- Scope by identity, not uid alone — pages by their slug, content by uid plus
  the expected pid. A foreign row at the same uid is then never written to.
- End with a `SELECT` that emits one line per record that is missing or
  foreign, and make the calling target exit non-zero on it. Capture the client
  output rather than piping it, so the client's own exit code stays separate
  from the grep:

```make
seed: ; @set -e; out=$$(mktemp); trap 'rm -f "$$out"' EXIT; \
	if ! $(COMPOSE) exec -T db sh -c '…' < data/seed.sql > "$$out" 2>&1; then \
		cat "$$out" >&2; exit 1; fi; \
	cat "$$out"; \
	if grep -q '^SEED-PROBLEM:' "$$out"; then exit 1; fi
```

## 2. A reserved uid band needs a high-water sentinel

Reserving a band (say 9000–9998) for seeded records does **not** work on its
own. `AUTO_INCREMENT` only ever tracks the highest uid present, so a seed record
inserted at 9000 moves the counter to 9001 and the next editorially created row
lands *inside* the band.

Seed one hidden placeholder at the **top** of the band and state the floor
outright:

```sql
INSERT IGNORE INTO pages (uid, pid, …, doktype, hidden, deleted)
VALUES (9999, 1, …, 254, 1, 1);      -- deleted=1: occupies the uid, invisible everywhere
ALTER TABLE pages AUTO_INCREMENT = 10000;
```

`deleted = 1` beats `hidden = 1` here: TYPO3 applies a `DeletedRestriction` to
effectively every query, so the row appears in neither the page tree, the
frontend, menus nor search — while still holding its uid. A hidden page would
sit greyed out in the page tree of an instance whose purpose is to be looked at.
The trade-off to state: a soft-deleted row *is* listed in the Recycler and can be
purged there, which is why the `ALTER TABLE` floor belongs in the file as well.
InnoDB only clamps that value upwards, so it can never hand out a taken uid.

Measured before and after on one instance: `AUTO_INCREMENT` moved from
`pages 183 / tt_content 627` — i.e. exactly where the next seed record wanted to
go — to `10000 / 10000`, and editorially created rows then landed at 10000+,
none inside the band.

## 3. A translated content element lives on its source page's pid

This one is counter-intuitive and costs a full deploy cycle every time it is got
wrong. A `tt_content` translation sits on the **same `pid` as its
default-language source**, not on the translated page:

| record | `pid` | `l18n_parent` | note |
|---|---|---|---|
| `tt_content` 606 (EN) | 164 | 0 | on the English page |
| `tt_content` 621 (DE) | **164** | 606 | *also* on the English page |
| `pages` 179 (DE) | 101 | 164 | the German page itself |

Put a translation on the translated page's uid and TYPO3 will not find it in
language 1 — the page renders, and renders empty. Pages behave differently:
`pages` translations take the pid of the *original's parent* (101 above).

## 4. Corrections must reach rows that already exist

Re-asserting structural fields is not enough; a corrected `bodytext` still only
reaches a fresh database. Restating the markup in the manifest would double the
file and give the same text two places to drift apart, so make the `INSERT`
itself the re-assert:

```sql
INSERT INTO tt_content (uid, pid, CType, header, bodytext, …)
VALUES (…)
ON DUPLICATE KEY UPDATE
  bodytext = IF(pid = VALUES(pid) AND CType = VALUES(CType) AND header = VALUES(header),
                VALUES(bodytext), bodytext);
```

Unqualified column names on the right are the **existing** row; `VALUES(col)` is
what the file wanted to insert. The assignment fires only when the occupying row
already agrees on pid, CType and header — that is, when it is ours. A foreign row
keeps its own value and is still reported by the verification.

Use `VALUES()`, not the MySQL 8.0.19 row-alias form (`… AS new … col = new.col`):
MariaDB has not adopted that syntax and answers `ERROR 1064` (checked on 12.3.2).

**State the consequence explicitly when adopting this:** seeded content edited in
the backend is reset on the next deploy. On a demo instance that is usually what
you want — the seed stays the single source of truth — but it is a behaviour
change and belongs in the PR body, not in a footnote.

## Quality gates on the seed file

A seed is fixture data, not deduplicable code: every showcase page is an INSERT
with near-identical markup by design, so duplication checks measure 40–90 % and
fail. Exclude `data/**` from analysis — and note that SonarCloud's **automatic
analysis reads only `.sonarcloud.properties`**, ignoring `sonar-project.properties`
(that one is for a CI-run scanner). Settings in the wrong file are silently
inert.
