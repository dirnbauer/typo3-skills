# Keyword matching, large UIDs and performance

Read this reference when writing or debugging the scoring code, when news with large UIDs come back
with no tags, or when a run is slow.

## Contents

- [Unicode-safe word boundaries](#unicode-safe-word-boundaries)
- [Large integer parameters dropping rows](#large-integer-parameters-dropping-rows)
- [Performance](#performance)

## Unicode-safe word boundaries

PHP's `\b` is ASCII-only and breaks on `ä/ö/ü/ß`. Use `\p{L}\p{N}` lookarounds and the `/u`
modifier:

```php
private function buildKeywordPattern(string $keyword): string
{
    $quoted = preg_quote($keyword, '/');
    // Short tokens (<=3 chars): require both word boundaries to avoid false positives.
    // Longer tokens: left boundary only - covers German plural/genitive and compound
    // suffixes (e.g. "phishing" matches "phishing-welle", "phishings", "phishingsoftware").
    if (mb_strlen($keyword, 'UTF-8') <= 3) {
        return '/(?<![\p{L}\p{N}])' . $quoted . '(?![\p{L}\p{N}])/u';
    }
    return '/(?<![\p{L}\p{N}])' . $quoted . '/u';
}
```

Score by the count of distinct matched keywords, not total occurrences: one keyword repeated 50
times must not outweigh four different keywords matching once each.

## Large integer parameters dropping rows

Observed in one project's DBAL stack: `$qb->createNamedParameter($uid, Connection::PARAM_INT)`
returned 0 rows for UIDs in the tens of millions although the row existed. Reproduce it in the
selected installation before adopting the workaround; a clean TYPO3 14.3 stack may not show it.

**Symptom.** `--debug-uid=29386376` reports "not found", while `SELECT … WHERE uid = 29386376` in
MySQL returns the row. The full fetch returns rows, but the loop processes different news than
expected: the result set is silently truncated.

**Workaround.** Use positional `?` parameters through the connection for queries on large integer
columns (news UIDs, `tt_content` UIDs, content relations):

```php
// Showed the defect for large ints:
$qb->expr()->eq('uid', $qb->createNamedParameter($uid, Connection::PARAM_INT));

// Use instead:
$conn->executeQuery(
    'SELECT … FROM tx_news_domain_model_news WHERE uid = ?',
    [$uid]
)->fetchAssociative();

// For IN clauses with int arrays, inline the cast values:
$ids = implode(',', array_map(static fn($v) => (int)$v, $chunk));
$conn->executeQuery("SELECT … WHERE tx_news_related_news IN ($ids) AND …");
```

Small integers (PID, hidden, deleted) work with `createNamedParameter`. The example command applies
the workaround throughout. Keep every value bound or cast to `int`; never interpolate raw input.

## Performance

- Tag upsert via DataHandler for the ~65 tag rows (slug eval, reference index): negligible cost.
- MM inserts via multi-row SQL in batches of 500. DataHandler MM writes cost O(n²) per record and
  add nothing for an MM table without TCA semantics.
- Select the latest N news with `ORDER BY datetime DESC LIMIT N`; index `datetime` if it is cold.
- Fetch `tt_content` in chunks of 200 news per `IN` query to stay below `max_allowed_packet` and
  prepared-statement parameter limits.
- The command calls DataHandler only for the tag upsert, so caches are barely touched during the
  bulk pass. Run `cache:flush` afterwards.
