# Counting news per language across a TYPO3 14.3 update

Read this reference when a TYPO3 14.3 update is planned or done on a site with EXT:news in more than
one language, or when translated news detail pages answer 404 or lose categories, tags or related
news after the update.

## Contents

- [What changed in 14.3.6](#what-changed-in-1436)
- [Count the news in the frontend](#count-the-news-in-the-frontend)
- [Explain every difference](#explain-every-difference)

## What changed in 14.3.6

From **14.3.6**, also reached by a patch update from 14.3.0–14.3.5, Extbase and with it EXT:news
follow each site language's `fallbackType`. A language that sets no `fallbackType` is `strict`.
`fallback` and `free` languages behave as before. (Verified 2026-10-31: Important-88886 and the
Extbase change ship in 14.3.6 and are absent from 14.3.5.) On a `strict` language:

- a detail URL of an untranslated news item answers **404** (news's default `detail.errorHandling`)
  where 13.4 rendered the default-language text;
- translated news lose untranslated categories, tags and related news;
- the selected-list plugin without `orderBy`, and the tags of a tag-filtered list, lose untranslated
  records;
- lists keep their items: on a `strict` language they never showed untranslated news.

The owner decides between: translating the news with their categories, tags and related news; a
listener that keeps the 13.4 overlay for EXT:news only; or `fallbackType: fallback`, which lets
untranslated page content fall back as well. Mechanism, the tested listener and the sources:
[typo3-v14-reference](../../typo3-v14-reference/references/13-v14-only-changes-manual-not-handled-by-rector.md#extbase-follows-fallbacktype-v1436).

## Count the news in the frontend

Count before and after the update.

1. Per site language, collect every news list page with its pagination pages, and a sample of detail
   URLs: translated news and untranslated ones. The language menu of a default-language detail page
   names the untranslated ones. One URL per line in `news-urls.txt`.
2. Count the rendered items with a stable selector from the site's own list template: the item
   wrapper (news default: `class="article articletype-`) and the category labels per page (default:
   `news-list-category`). Keep the HTTP status: a detail URL may turn into a 404.

   ```bash
   RUN=before   # after the update: RUN=after
   ITEM='class="article articletype-'; LABEL='news-list-category'
   while read -r url; do
     page=$(mktemp); code=$(curl -sk -o "$page" -w '%{http_code}' "$url")
     printf '%s\t%s\t%s\t%s\n' "$url" "$code" "$(grep -o "$ITEM" "$page" | wc -l | tr -d ' ')" \
       "$(grep -o "$LABEL" "$page" | wc -l | tr -d ' ')"
     rm -f "$page"
   done < news-urls.txt > "news-count-$RUN.tsv"
   # once both runs exist: URL, HTTP status, items, category labels
   diff news-count-before.tsv news-count-after.tsv
   ```

In a `typo3-upgrade-run` the "before" comes from the sealed Baseline A, not from a new request
([fix pack item 15](../../typo3-upgrade-run/references/typo3-14-fix-pack.md#15-extbase-follows-fallbacktype-1436)).

## Explain every difference

Compare with the visible news per language in the database:

```sql
SELECT sys_language_uid, COUNT(*) AS visible, SUM(l10n_parent > 0) AS translations,
       SUM(l10n_parent = 0) AS own_records
  FROM tx_news_domain_model_news
 WHERE deleted = 0 AND hidden = 0 AND t3ver_wsid = 0
   AND (starttime = 0 OR starttime <= UNIX_TIMESTAMP())
   AND (endtime = 0 OR endtime > UNIX_TIMESTAMP())
 GROUP BY sys_language_uid;
```

Default-language news without a visible translation are what a `strict` language hides. A list also
filters by storage folder, categories and archive settings: compare per plugin, not per site. An
unexplained difference or a new 404 goes to the owner before the update goes live.
