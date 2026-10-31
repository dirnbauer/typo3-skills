# News tag workflow in detail

Read this reference when you run the tagging workflow: the corpus queries, catalogue and keyword
rules, the tag route, the command's feature list, dry-run targets, verification SQL, and the
optional `b13/tag` setup. Checked against `georgringer/news` 14.1.2 on TYPO3 14.3.9 (2026-10-31).

## Contents

- [1. Verify the corpus](#1-verify-the-corpus)
- [2. Derive tag candidates from corpus frequency](#2-derive-tag-candidates-from-corpus-frequency)
- [3. Decide on tag storage and routing](#3-decide-on-tag-storage-and-routing)
- [4. The console command](#4-the-console-command)
- [5. Iterate with --dry-run](#5-iterate-with---dry-run)
- [6. Run for real](#6-run-for-real)
- [7. Verify](#7-verify)
- [Adding b13/tag](#adding-b13tag)

## 1. Verify the corpus

```bash
ddev mysql -e "SELECT COUNT(*) FROM tx_news_domain_model_news WHERE pid=<PID> AND deleted=0 AND hidden=0;"
ddev mysql -e "SELECT COUNT(*) FROM tx_news_domain_model_tag WHERE deleted=0;"
ddev mysql -e "SELECT COUNT(*) FROM tx_news_domain_model_news_tag_mm;"
```

Identify where the readable text lives. With EXT:news's `contentElementRelation` extension setting
(default on) or Mask-based content, `tx_news_domain_model_news.bodytext` is often empty and the
real content sits in `tt_content` rows linked via `tt_content.tx_news_related_news`:

```sql
SELECT AVG(LENGTH(bodytext)) FROM tx_news_domain_model_news WHERE pid=<PID> AND deleted=0;
SELECT CType, COUNT(*) FROM tt_content
  WHERE tx_news_related_news > 0 AND deleted=0 AND hidden=0
  GROUP BY CType ORDER BY 2 DESC;
```

If the average bodytext length is about 0, harvest `tt_content`; scoring is meaningless otherwise.

## 2. Derive tag candidates from corpus frequency

Read 50–100 titles and teasers first:

```sql
SELECT uid, title, LEFT(teaser, 200) FROM tx_news_domain_model_news
  WHERE pid=<PID> AND deleted=0 AND hidden=0
  ORDER BY datetime DESC LIMIT 100;
```

Then run a frequency analysis on the full target corpus (latest N news plus their linked
`tt_content`). Brainstorm about 100 candidate concepts with 1–3 keywords each, count how many news
mention each, and keep the top ~65 (or the count you need). This surfaces recurring themes nobody
guessed: *Unternehmen* and *Polizei* ranked top-5 in the example corpus and were on no guess list.

**Single-concept rule.** Each tag is one concept, never an `X & Y` combination. Compose several
tags per news instead:

| Avoid | Prefer |
|---|---|
| `Banking & Konto` | `Banking` + `Konto` |
| `Künstliche Intelligenz & Deepfake` | `Künstliche Intelligenz` + `Deepfake` |
| `Paket & Lieferung` | `Paket` + `Lieferung` (+ `DHL` if relevant) |
| `Reise & Urlaub` | `Reise` + `Hotel` + `Flug` |

Hyphenated compounds (`Fake-Shop`, `Online-Shopping`, `Login-Daten`) and standard two-word concepts
(`Künstliche Intelligenz`) are one concept.

Each tag needs a name, a slug (lowercase, ASCII, hyphenated) and curated keywords. See
[NewsThematicTags.example.php](NewsThematicTags.example.php) for 65 German fraud-prevention tags
derived from a ~1500-news corpus.

**Keyword rules:**

- Lowercase. Singular and plural where common (`fake-shop`, `fake-shops`).
- Hyphenated, spaced and joined spellings (`fake-shop`, `fake shop`, `fakeshop`).
- Compound nouns over generic words (`kostenpflichtiges abo` over `kosten`).
- Short prefixes over-match under the left-only boundary: `auto` hits `autor`, `automatisch`. Use
  compounds (`autokauf`, `autoverkauf`, `kfz`). Same trap: `apple` (`applied`), `bank`
  (`bankrott`), `post` (`posten`).
- 1–3 character tokens (`tan`, `ki`, `sms`) are fine: the command applies both-side boundaries to
  them automatically.
- 5–15 keywords per tag; broaden a tag that under-fires in the dry run.
- Multi-word keywords match verbatim after whitespace collapse; be specific.

## 3. Decide on tag storage and routing

Tags live on a storage PID; use the news PID unless the project already separates them. The route
uses the tag's `slug`, not its PID. Wire the tag route before publishing tag URLs:

```yaml
routeEnhancers:
  News:
    type: Extbase
    extension: News
    plugin: Pi1
    routes:
      - routePath: '/{tag-name}'
        _controller: 'News::list'
        _arguments:
          tag-name: overwriteDemand/tags
    aspects:
      tag-name:
        type: NewsTag
```

The `NewsTag` aspect ships with EXT:news (`NewsTagMapper`, registered in its `ext_localconf.php`).
A `PersistedAliasMapper` on `tx_news_domain_model_tag.slug` is the older alternative.

## 4. The console command

Create one command per package in `Classes/Command/AssignNewsTagsCommand.php` and register it in
`Configuration/Services.yaml` with the `console.command` tag
([Services.example.yaml](Services.example.yaml)).
[AssignNewsTagsCommand.example.php](AssignNewsTagsCommand.example.php) is a complete, idempotent
implementation that:

- loads the tag catalogue from a PHP config file;
- upserts tags via DataHandler (slug generation, reference index);
- harvests content from `tt_content` linked via `tx_news_related_news`;
- normalizes HTML → lowercase → collapsed whitespace;
- scores each tag by distinct keyword matches, not total occurrences;
- selects the top N tags per news (5–10 typical, threshold ≥ 1);
- bulk-inserts MM rows with a multi-row `INSERT` (batches of 500), which bypasses DataHandler and
  therefore `sys_refindex`; run `ddev exec vendor/bin/typo3 referenceindex:update` after the run;
- updates the `tx_news_domain_model_news.tags` counter for the backend list;
- supports `--dry-run`, `--reset`, `--limit`, `--storage-pid`, `--force`, `--debug-uid`.

## 5. Iterate with --dry-run

```bash
ddev exec vendor/bin/typo3 cache:flush
ddev exec vendor/bin/typo3 <vendor>:news:assign-tags --dry-run --limit=300
```

The dry run prints the tags-per-news distribution and per-tag popularity. Healthy targets for a
news corpus:

- median 5+, p25 ≥ 3, p75 ≤ 8;
- unmatched (0 tags) under 1 % of the corpus;
- the most popular tag covers at most 60 % of news; the least popular at least 1 %.

If many news get only 1–2 tags, broaden the keywords of the anchor tags (for a fraud corpus:
E-Mail-Betrug, Banking, Werbung). A tag with 0 matches has wrong keywords or is not in the corpus;
fix or replace it.

## 6. Run for real

```bash
ddev exec vendor/bin/typo3 <vendor>:news:assign-tags --reset --force
ddev exec vendor/bin/typo3 referenceindex:update
ddev exec vendor/bin/typo3 cache:flush
```

`--reset` truncates `tx_news_domain_model_news_tag_mm` and deletes the tags on the storage PID before
recreating them, which suits iteration on keywords. Drop `--reset` for additive runs once the
catalogue is stable. Expect about 150 news per second on a typical DDEV setup.

## 7. Verify

```sql
-- 1. All tags present
SELECT COUNT(*) FROM tx_news_domain_model_tag WHERE pid=<PID> AND deleted=0;

-- 2. MM rows = sum(tags-per-news)
SELECT COUNT(*) FROM tx_news_domain_model_news_tag_mm;

-- 3. Distribution
SELECT tags_per_news, COUNT(*) AS news FROM (
  SELECT uid_local, COUNT(*) AS tags_per_news
  FROM tx_news_domain_model_news_tag_mm GROUP BY uid_local
) t GROUP BY tags_per_news ORDER BY tags_per_news;

-- 4. Counter consistency (must return 0 rows)
SELECT n.uid, n.tags, COUNT(mm.uid_foreign) AS actual
FROM tx_news_domain_model_news n
LEFT JOIN tx_news_domain_model_news_tag_mm mm ON mm.uid_local = n.uid
WHERE n.pid=<PID> AND n.deleted=0
GROUP BY n.uid, n.tags HAVING n.tags <> actual LIMIT 20;

-- 5. Per-tag popularity
SELECT t.title, COUNT(mm.uid_local) AS n
FROM tx_news_domain_model_tag t
LEFT JOIN tx_news_domain_model_news_tag_mm mm ON mm.uid_foreign = t.uid
WHERE t.pid=<PID> AND t.deleted=0
GROUP BY t.uid, t.title ORDER BY n DESC;

-- 6. Backend spot-check
SELECT n.uid, LEFT(n.title, 60), GROUP_CONCAT(t.title ORDER BY mm.sorting)
FROM tx_news_domain_model_news n
JOIN tx_news_domain_model_news_tag_mm mm ON mm.uid_local = n.uid
JOIN tx_news_domain_model_tag t ON t.uid = mm.uid_foreign
WHERE n.pid=<PID> AND n.deleted=0
GROUP BY n.uid ORDER BY n.datetime DESC LIMIT 10;
```

Backend check: News module → a recent news → the "Relations" tab shows the tags (categories are in
the separate "Categories" tab). Frontend check: `https://<site>/<tag-slug>/` lists the tagged news.

## Adding b13/tag

`b13/tag` provides a generic `sys_tag` table that can tag any record through an int `keywords`
column. It does not integrate with EXT:news tags and does not replace them.

```bash
ddev composer require b13/tag
ddev exec vendor/bin/typo3 extension:setup
ddev mysql -e "SHOW TABLES LIKE 'sys_tag%';"   # sys_tag + sys_tag_mm
```

To use it on a custom table:

1. Add `keywords int(11) unsigned DEFAULT '0' NOT NULL` to the table's SQL.
2. Configure TCA via `B13\Tag\TcaHelper`.
3. Register the field via `ExtensionManagementUtility::addToAllTCAtypes()`.

Check the [b13/tag README](https://github.com/b13/tag) for the current TCA wiring and its TYPO3
14.3 compatibility before installing.
