---
name: "typo3-news-tags"
description: "Bulk-generates thematic tags for georgringer/news (EXT:news) and assigns them to existing news records via keyword matching. Use when tagging large news corpora, defining a generic tag catalogue, building a Symfony console command for tag assignment, working with tx_news_domain_model_tag / tx_news_domain_model_news_tag_mm, or installing b13/tag as a generic site-wide tagging capability alongside news tags. Also use when, after a TYPO3 14.3 update, news detail pages answer 404 or lose their categories in a translated language (fallbackType strict), to count the news per language before and after."
compatibility: "TYPO3 14.x (EXT:news ^14)"
metadata:
  skill_type: preference
  version: "1.0.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---

# TYPO3 News Tags — Bulk Generation & Assignment

> Source: https://github.com/dirnbauer/typo3-skills

Targets TYPO3 14.3 with `georgringer/news` 14 (14.1.2 requires `^13.4.29 || ^14.3`, Packagist,
verified 2026-10-31). Do not use this skill for v12/v13 sites.

**Scope:** designing, generating and assigning thematic news tags (`tx_news_domain_model_tag`) at
scale, from hundreds to tens of thousands of news; optionally installing the separate generic tag
system `b13/tag` (`sys_tag`); and the per-language news count around a TYPO3 14.3 update.
**Not in scope:** rendering tags in Fluid, tag translations, tag merging.

## Rules

- **Verify the corpus first.** Count news, tags and MM rows on the storage PID, and find where the
  text lives: with `contentElementRelation` (EXT:news default) `bodytext` is often empty and the
  content sits in `tt_content` rows linked by `tx_news_related_news`. Scoring empty bodytext
  produces 0–1 tags per news.
- **Let the corpus pick the catalogue.** Run a frequency analysis over the target news before
  fixing tags; guessed catalogues miss the real recurring themes.
- **One concept per tag**, never `X & Y`. Compose several tags per news instead.
- **Tags orthogonal to categories.** Categories are the hierarchical bucket; tags are flat thematic
  crosscuts (5–10 per news), not copies of the categories.
- **Tags through DataHandler, MM rows through bulk SQL.** DataHandler generates the slug and the
  reference index for the ~65 tag rows; multi-row `INSERT` writes the MM rows, then update the
  `tx_news_domain_model_news.tags` counter. The raw `INSERT` bypasses DataHandler, so finish with
  `ddev exec vendor/bin/typo3 referenceindex:update` to rebuild `sys_refindex` for the MM rows.
  Look a tag up by slug before creating it.
- **Dry run before the real run.** Review the distribution; run `--reset --force` only after it
  meets the targets, then flush caches.
- **Wire the `NewsTag` route aspect before publishing tag URLs.**
- **Keep EXT:news tags for news.** `b13/tag` tags other tables and does not integrate with EXT:news.

## Workflow

Read [tag-workflow.md](references/tag-workflow.md) for the queries, keyword rules, route YAML,
dry-run targets and verification SQL of each step.

1. **Verify the corpus** (always): counts, text location, average bodytext length.
2. **Derive ~100 candidate concepts** from titles, teasers and linked content; keep the top ~65 by
   news coverage. Each tag gets a name, an ASCII slug and 5–15 lowercase keywords covering
   plural, hyphenated and joined spellings; avoid short prefixes such as `auto` or `bank`.
3. **Decide tag storage** (normally the news PID) and check the `NewsTag` route enhancer.
4. **Build the console command** from
   [AssignNewsTagsCommand.example.php](references/AssignNewsTagsCommand.example.php) and register
   it ([Services.example.yaml](references/Services.example.yaml)). Adapt the catalogue from
   [NewsThematicTags.example.php](references/NewsThematicTags.example.php).
5. **Iterate with `--dry-run --limit=300`** until median ≥ 5, p25 ≥ 3, unmatched under 1 %, the top
   tag covers at most 60 % and every tag at least 1 %.
6. **Run for real** with `--reset --force`, then `referenceindex:update` and `cache:flush`. Drop
   `--reset` once the catalogue is stable.
7. **Verify** in SQL (counts, distribution, counter consistency), in the News module ("Relations"
   tab) and at `https://<site>/<tag-slug>/`.

Read [matching-and-performance.md](references/matching-and-performance.md) when writing the scoring
code (Unicode-safe boundaries, distinct-keyword scoring), when news with large UIDs get no tags,
or when a run is slow.

## Translated news after a TYPO3 14.3 update

From 14.3.6 (also by patch update from 14.3.0–14.3.5) Extbase, and with it EXT:news, follows each
site language's `fallbackType`; a language without the key is `strict`. There, untranslated news
detail URLs answer 404, and translated news lose untranslated categories, tags and related news.
Count the rendered news per language before and after the update, explain every difference from
the database, and let the owner choose translation, an EXT:news-only overlay listener, or
`fallbackType: fallback`. Procedure and script:
[translated-news-count.md](references/translated-news-count.md).

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| Median tags-per-news is 1–2 | Keywords too narrow, or empty `bodytext` without harvesting `tt_content` | Broaden the anchor tags' keywords; verify the content fetch is wired |
| Newest news (large UID) have 0 tags despite obvious keywords | `createNamedParameter(PARAM_INT)` dropped rows in that DBAL stack | Reproduce, then use positional parameters ([details](references/matching-and-performance.md#large-integer-parameters-dropping-rows)) |
| Tags exist but slugs are NULL | Created via direct `INSERT` instead of DataHandler | Upsert tags with DataHandler `process_datamap` so the slug eval runs |
| `tx_news_domain_model_news.tags` counter is wrong | Counter not updated after MM writes | Recount once from the MM table, then make the command write it |
| Frontend `/<tag-slug>/` answers 404 | Route enhancer missing | Add the `News` route with the `NewsTag` aspect and flush caches |
| Identical tag created twice on re-run | No lookup before insert | Select by slug before each DataHandler `NEW…`; reuse the UID |
| Translated news detail pages answer 404 or lose tags after a 14.3 update | Extbase follows `fallbackType` from 14.3.6 | Count per language and let the owner decide |

## Acceptance checklist

Before reporting "done":

- [ ] Storage PID confirmed and tags created there
- [ ] `--dry-run` distribution reviewed against the targets in step 5
- [ ] Counter consistency query returns 0 rows
- [ ] `ddev exec vendor/bin/typo3 referenceindex:update` ran after the last MM write
- [ ] Backend News module shows tags on a recent record
- [ ] `https://<site>/<tag-slug>/` resolves to the filtered news list
- [ ] Command is re-runnable (`--reset` works; a second run is idempotent)
- [ ] If `b13/tag` was installed, `sys_tag` and `sys_tag_mm` exist and the extension is active

## Files in this skill

- [tag-workflow.md](references/tag-workflow.md): the seven workflow steps in detail and `b13/tag`
  setup. Load when running the workflow.
- [matching-and-performance.md](references/matching-and-performance.md): keyword regex, the
  large-UID parameter defect, batch sizes. Load when writing or debugging the command.
- [translated-news-count.md](references/translated-news-count.md): the 14.3.6 `fallbackType`
  change and the before/after count. Load for multilingual news around an update.
- `references/AssignNewsTagsCommand.example.php` (read and adapt): the complete idempotent command.
- `references/NewsThematicTags.example.php` (read and adapt): 65 single-concept German tags.
- `references/Services.example.yaml` (copy): command registration.
