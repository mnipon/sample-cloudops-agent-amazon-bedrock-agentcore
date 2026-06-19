# RDS EOL Scraper Multi-Engine Support Bugfix Design

## Overview

The RDS EOL scraper (`eol_scraper/scrapers/rds.py`) only scrapes one documentation URL (RDS MySQL version management), causing all other RDS/Aurora engines to report "Unknown" EOL dates. The fix expands the `DOC_URLS` dictionary to include documentation pages for RDS PostgreSQL, Aurora MySQL, Aurora PostgreSQL, and RDS MariaDB, and adapts the scraping logic to handle the different HTML table structures across these pages. The existing API-fetch and merge logic remains unchanged.

## Glossary

- **Bug_Condition (C)**: The scraper is invoked for a non-MySQL RDS/Aurora engine (or for MySQL with incomplete URLs), and no documentation URL exists in `DOC_URLS` for that engine, resulting in "Unknown" EOL dates.
- **Property (P)**: For every engine with a configured documentation URL, the scraper correctly parses the EOL table and returns valid date strings for `end_of_standard_support` and `end_of_extended_support`.
- **Preservation**: The existing API fetch via `DescribeDBEngineVersions`, the merge logic that enriches API records with scraped dates, the inclusion of unmatched scraped items, and the DynamoDB record schema must remain unchanged.
- **DOC_URLS**: Dictionary in `rds.py` mapping service names to lists of documentation URLs to scrape.
- **`_scrape_major_version_table`**: The function that fetches a URL, parses HTML tables using BeautifulSoup, and extracts version/EOL-date pairs.
- **`_fetch_from_api`**: The function that queries the RDS API for all engine versions across mysql, postgres, aurora-mysql, aurora-postgresql.
- **`fetch(region)`**: The public entry point that combines API data with scraped data.

## Bug Details

### Bug Condition

The bug manifests when the scraper runs for any RDS/Aurora engine other than RDS MySQL. The `DOC_URLS` dictionary contains only one entry (`rds-mysql`), so the scraping loop produces zero results for `rds-postgresql`, `aurora-mysql`, `aurora-postgresql`, and `mariadb`. When these scraped results are merged with API data, all API records retain their default "Unknown" date values.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { service: string, region: string }
  OUTPUT: boolean

  RETURN input.service IN ['rds-postgresql', 'aurora-mysql', 'aurora-postgresql', 'rds-mariadb']
         OR (input.service == 'rds-mysql' AND DOC_URLS['rds-mysql'] is incomplete)
END FUNCTION
```

### Examples

- **RDS PostgreSQL**: API returns versions 12, 13, 14, 15, 16, 17. No URL configured → all get "Unknown" dates. Expected: dates scraped from PostgreSQL release calendar page.
- **Aurora MySQL**: API returns versions 2, 3. No URL configured → all get "Unknown" dates. Expected: dates scraped from Aurora MySQL release calendar page.
- **Aurora PostgreSQL**: API returns versions 12, 13, 14, 15, 16, 17. No URL configured → all get "Unknown" dates. Expected: dates scraped from Aurora PostgreSQL release calendar page.
- **RDS MariaDB**: API returns versions 10.4, 10.5, 10.6, 10.11, 10.11. No URL configured → all get "Unknown" dates. Expected: dates scraped from MariaDB version management page.
- **RDS MySQL (edge case)**: API returns versions 5.7, 8.0, 8.4. Single URL configured → dates found, but supplemental pages may have additional or updated dates.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- The `_fetch_from_api` function must continue to query `DescribeDBEngineVersions` for all four engines (mysql, postgres, aurora-mysql, aurora-postgresql) using pagination and return `{service, version, status, source}` records.
- The merge logic in `fetch()` must continue to enrich API records with scraped dates when a `(service, version)` key matches.
- Versions without matching scraped dates must continue to have "Unknown" as their date values rather than being omitted.
- Scraped items not found in the API must continue to be appended to results.
- The output record schema `{service, version, end_of_standard_support, end_of_extended_support, status, source}` must remain unchanged.
- The `_extract_date` helper function must continue to parse dates in YYYY-MM-DD, "Month DD, YYYY", and "Mon DD, YYYY" formats.

**Scope:**
All inputs that do NOT involve changes to the URL list or HTML parsing are completely unaffected. This includes:

- API-only data paths (opensearch, msk, eks, elasticache scrapers)
- DynamoDB write logic in `main.py`
- The MCP server tool interface in `eol_reader.py`

## Hypothesized Root Cause

Based on the bug analysis, the root cause is straightforward:

1. **Missing URL Configuration**: `DOC_URLS` only contains one entry for `rds-mysql`. The fix is to add entries for all other engines.

2. **Table Structure Mismatch**: Different AWS documentation pages use different table formats:
   - Some pages use "Major version" as the first column header
   - Some pages use "Community release date" or "Release" columns
   - The release calendar pages may use "Minor version" rather than "Major version"
   - Column ordering varies across pages (standard support date position differs)

   The current `_scrape_major_version_table` function requires headers to contain both "major version" and "end of extended support", which may not match all target pages.

3. **Version String Parsing Differences**: Different engines use different version formats:
   - MySQL: `5.7`, `8.0`, `8.4`
   - PostgreSQL: `12`, `13`, `14`, `15`, `16`, `17`
   - Aurora MySQL: `2`, `3`
   - Aurora PostgreSQL: `12.x`, `13.x`, etc.
   - MariaDB: `10.4`, `10.5`, `10.6`, `10.11`

   The regex `r"(\d+\.?\d*)"` in `_scrape_major_version_table` should handle these, but table cell formats may differ.

4. **MariaDB Not in API**: The `_fetch_from_api` function does not query the `mariadb` engine. MariaDB versions would need to be added to the API fetch or handled purely through scraping.

## Correctness Properties

Property 1: Bug Condition - Multi-Engine EOL Dates Populated

_For any_ invocation of `fetch(region)` where the RDS API returns versions for rds-postgresql, aurora-mysql, aurora-postgresql, or rds-mariadb, the fixed scraper SHALL return records with non-"Unknown" values for `end_of_standard_support` and/or `end_of_extended_support` for at least some versions of each engine (those that appear in the corresponding documentation page's EOL table).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - API Fetch and Merge Behavior Unchanged

_For any_ invocation of `fetch(region)`, the fixed code SHALL produce results that include all versions returned by `_fetch_from_api` (even those without scraped dates), continue to merge scraped dates onto matching API records, continue to append scraped-only items, and use the same output record schema as before the fix.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `inventory-mcp-agentcore/eol-scraper/eol_scraper/scrapers/rds.py`

**Function**: `DOC_URLS` dictionary and `_scrape_major_version_table`

**Specific Changes**:

1. **Expand DOC_URLS dictionary**: Add URLs for all engine families. Each service key maps to a list of URLs to scrape (some engines have multiple relevant pages):

   ```python
   DOC_URLS = {
       "rds-mysql": [
           "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/MySQL.Concepts.VersionMgmt.html",
       ],
       "aurora-mysql": [
           "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraMySQLReleaseNotes/AuroraMySQL.release-calendars.html",
       ],
       "rds-postgresql": [
           "https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-release-calendar.html",
           "https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html",
       ],
       "aurora-postgresql": [
           "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/aurorapostgresql-release-calendar.html",
       ],
       "rds-mariadb": [
           "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/MariaDB.Concepts.VersionMgmt.html",
       ],
   }
   ```

2. **Generalize table header detection**: Relax the header matching in `_scrape_major_version_table` to accept tables that have either "major version" or "version" in a header AND at least one column with "end of" or "standard support" or "extended support" in the header text. This accommodates the different table formats across documentation pages.

3. **Handle version column flexibility**: Update the version extraction to look at the first cell regardless of whether the header says "major version", "minor version", or just "version".

4. **Support date columns by position fallback**: When column-header-based indexing fails, fall back to checking the last few columns for date-like content (YYYY-MM-DD patterns or month name patterns).

5. **Add MariaDB to API fetch**: Add `("mariadb", "rds-mariadb")` to the engine list in `_fetch_from_api` so MariaDB versions are also retrieved from the API.

6. **Update scraping loop**: Change the `fetch()` function's scraping loop to iterate over URL lists rather than single URLs, accumulating results from all pages for each service.

## Runtime Verification Loop

### Overview

Since EOL date schedules are critical for upgrade decisions, the scraper implements a built-in runtime verification loop that validates scraped data quality after each scraping pass. This is not a test-only mechanism — it runs as part of the normal scraping pipeline to catch data quality issues before writing to DynamoDB.

### Verification Steps

The verification loop executes after all URLs for a service have been scraped but before the merge with API data. It performs five checks in sequence:

#### 1. Date Format Validation

After scraping, verify all extracted date values match the `YYYY-MM-DD` format (i.e., they are not garbage strings, partial HTML, or unparsed text).

```
FUNCTION validateDateFormats(scraped_results)
  INPUT: scraped_results of type list[dict]
  OUTPUT: list of invalid entries

  invalid = []
  date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
  FOR EACH record IN scraped_results DO
    FOR EACH field IN ['end_of_standard_support', 'end_of_extended_support'] DO
      value = record[field]
      IF value != "Unknown" AND NOT date_pattern.match(value) THEN
        invalid.append({record, field, value})
      END IF
    END FOR
  END FOR
  RETURN invalid
END FUNCTION
```

**Behavior**: Invalid entries are logged as warnings and their date fields are reset to "Unknown" to prevent garbage data from reaching DynamoDB.

#### 2. Chronological Sanity Check

Verify that `end_of_extended_support >= end_of_standard_support` when both dates are present and valid. Extended support logically cannot end before standard support.

```
FUNCTION validateChronologicalOrder(scraped_results)
  INPUT: scraped_results of type list[dict]
  OUTPUT: list of chronologically invalid entries

  invalid = []
  FOR EACH record IN scraped_results DO
    std = record['end_of_standard_support']
    ext = record['end_of_extended_support']
    IF std != "Unknown" AND ext != "Unknown" THEN
      IF ext < std THEN  -- string comparison works for YYYY-MM-DD
        invalid.append({record, std, ext})
      END IF
    END IF
  END FOR
  RETURN invalid
END FUNCTION
```

**Behavior**: Records with inverted dates are logged as warnings. The dates are still written (they may reflect upstream doc errors), but a warning is emitted so operators can investigate.

#### 3. Coverage Threshold Check

After scraping all URLs for a given service, verify that at least N% (configurable, default 50%) of API-known versions received non-"Unknown" dates. If below threshold, it signals the documentation page structure may have changed.

```
FUNCTION validateCoverageThreshold(service, scraped_results, api_versions, threshold=0.50)
  INPUT:
    service: string
    scraped_results: list[dict] for this service
    api_versions: list[string] of versions known from the RDS API
    threshold: float (default 0.50)
  OUTPUT: boolean (True if coverage meets threshold)

  IF len(api_versions) == 0 THEN
    RETURN True  -- no versions to check against
  END IF

  versions_with_dates = count(r for r in scraped_results
    WHERE r['end_of_standard_support'] != "Unknown"
       OR r['end_of_extended_support'] != "Unknown")

  coverage = versions_with_dates / len(api_versions)

  IF coverage < threshold THEN
    LOG WARNING: f"{service}: only {coverage*100:.0f}% of API-known versions got scraped dates
                  ({versions_with_dates}/{len(api_versions)}). Doc page structure may have changed."
    RETURN False
  END IF
  RETURN True
END FUNCTION
```

**Behavior**: A warning is logged when coverage is below the threshold. Scraping still proceeds (low coverage is better than no data), but the warning enables alerting for doc page structure changes.

**Configuration**: The threshold is configurable via an environment variable `EOL_COVERAGE_THRESHOLD` (float, default `0.50`).

#### 4. Date Range Plausibility

Verify that all scraped dates fall within a plausible range (2020-01-01 to 2035-12-31) to catch parsing errors that produce nonsensical years (e.g., "0202-03-01" from misaligned column parsing).

```
FUNCTION validateDateRange(scraped_results, min_year=2020, max_year=2035)
  INPUT: scraped_results of type list[dict]
  OUTPUT: list of out-of-range entries

  invalid = []
  FOR EACH record IN scraped_results DO
    FOR EACH field IN ['end_of_standard_support', 'end_of_extended_support'] DO
      value = record[field]
      IF value != "Unknown" THEN
        year = int(value[0:4])
        IF year < min_year OR year > max_year THEN
          invalid.append({record, field, value, year})
        END IF
      END IF
    END FOR
  END FOR
  RETURN invalid
END FUNCTION
```

**Behavior**: Dates outside the plausible range are logged as warnings and reset to "Unknown" to prevent clearly wrong data from being stored.

#### 5. Cross-Service Deduplication Check

Ensure no version is written with conflicting dates from different source URLs. When multiple URLs for the same service produce different dates for the same version, this check flags the conflict.

```
FUNCTION validateNoDuplicateConflicts(all_scraped_by_service)
  INPUT: all_scraped_by_service of type dict[service -> list[dict]]
  OUTPUT: list of conflicts

  conflicts = []
  FOR EACH service, records IN all_scraped_by_service DO
    seen = {}  -- version -> {end_of_standard_support, end_of_extended_support, source_url}
    FOR EACH record IN records DO
      key = record['version']
      IF key IN seen THEN
        existing = seen[key]
        IF (existing['end_of_standard_support'] != record['end_of_standard_support']
            AND existing['end_of_standard_support'] != "Unknown"
            AND record['end_of_standard_support'] != "Unknown") OR
           (existing['end_of_extended_support'] != record['end_of_extended_support']
            AND existing['end_of_extended_support'] != "Unknown"
            AND record['end_of_extended_support'] != "Unknown") THEN
          conflicts.append({service, key, existing, record})
        END IF
      ELSE
        seen[key] = record
      END IF
    END FOR
  END FOR
  RETURN conflicts
END FUNCTION
```

**Behavior**: Conflicts are logged as warnings. The first-seen value wins (earlier URL takes priority), consistent with the "later URLs should not overwrite earlier results" rule from the scraping loop design.

### Integration Point

The verification loop runs inside `fetch(region)` after the scraping loop completes and before the merge with API data:

```python
def fetch(region: str) -> list[dict]:
    api_data = _fetch_from_api(region)

    scraped = {}
    for service, urls in DOC_URLS.items():
        service_scraped = []
        for url in urls:
            service_scraped.extend(_scrape_major_version_table(url, service))

        # --- Runtime Verification Loop ---
        service_scraped = _verify_scraped_data(service, service_scraped, api_data)
        # --- End Verification Loop ---

        for item in service_scraped:
            scraped.setdefault((item["service"], item["version"]), item)

    # Merge logic (unchanged) ...
```

### Configuration

| Environment Variable     | Default | Description                                                        |
| ------------------------ | ------- | ------------------------------------------------------------------ |
| `EOL_COVERAGE_THRESHOLD` | `0.50`  | Minimum fraction of API-known versions that must get scraped dates |
| `EOL_MIN_YEAR`           | `2020`  | Earliest plausible year for EOL dates                              |
| `EOL_MAX_YEAR`           | `2035`  | Latest plausible year for EOL dates                                |

### Error Handling Philosophy

The verification loop follows a **warn-and-continue** philosophy:

- Data quality issues are logged as warnings, not raised as exceptions
- Clearly invalid data (bad formats, implausible years) is reset to "Unknown" to prevent garbage in DynamoDB
- Questionable data (inverted chronology) is preserved but flagged, since it might reflect real upstream documentation errors
- Low coverage is warned about but does not halt scraping — partial data is better than no data

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that invoke `rds.fetch(region)` with mocked API responses, then check how many records have "Unknown" dates per service. Run these tests on the UNFIXED code to observe that non-MySQL services all show "Unknown".

**Test Cases**:

1. **PostgreSQL Missing Dates**: Call `fetch()`, filter results to `rds-postgresql` → all have "Unknown" dates (will fail on unfixed code)
2. **Aurora MySQL Missing Dates**: Call `fetch()`, filter results to `aurora-mysql` → all have "Unknown" dates (will fail on unfixed code)
3. **Aurora PostgreSQL Missing Dates**: Call `fetch()`, filter results to `aurora-postgresql` → all have "Unknown" dates (will fail on unfixed code)
4. **MariaDB Not Present**: Call `fetch()`, check no `rds-mariadb` records exist at all (will fail on unfixed code)

**Expected Counterexamples**:

- All non-MySQL services return 0 scraped dates
- Possible causes: missing DOC_URLS entries, table header mismatch on new pages

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**

```
FOR ALL service IN ['rds-postgresql', 'aurora-mysql', 'aurora-postgresql', 'rds-mariadb'] DO
  results := fetch_fixed(region)
  service_results := filter(results, service)
  dates_found := count(r for r in service_results where r.end_of_standard_support != "Unknown")
  ASSERT dates_found > 0
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT fetch_original(input) = fetch_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for the RDS MySQL service (which already has a URL), then write property-based tests that verify:

1. The API fetch logic returns the same set of versions before and after the fix
2. The merge logic produces the same enrichment behavior
3. The output schema remains identical

**Test Cases**:

1. **API Fetch Preservation**: Verify that `_fetch_from_api` returns versions for mysql, postgres, aurora-mysql, aurora-postgresql with the same schema after adding mariadb
2. **Merge Logic Preservation**: Verify that when a scraped record matches an API record, the API record's dates are overwritten and the source updated
3. **Unmatched Version Preservation**: Verify that API versions without scraped dates retain "Unknown" values
4. **Scraped-Only Preservation**: Verify that scraped items not in API are still appended to results
5. **Output Schema Preservation**: Verify all output records have exactly the required keys

### Unit Tests

- Test `_extract_date` with various date formats from different doc pages
- Test `_scrape_major_version_table` with mocked HTML for each engine's table structure
- Test header detection logic with varied column names
- Test version regex extraction for each engine's version format
- Test edge cases: empty tables, missing columns, malformed HTML

### Property-Based Tests

- Generate random sets of API versions and scraped versions, verify the merge logic always produces the correct union
- Generate random HTML tables with known structure variations, verify the parser extracts dates correctly
- Generate random date strings in supported formats, verify `_extract_date` produces valid YYYY-MM-DD output or returns the input unchanged

### Integration Tests

- Run the full `fetch()` function against live AWS documentation pages (with mocked API) and verify at least some dates are populated for each engine
- Run with mocked responses from each documentation URL and verify the complete pipeline produces expected output
- Test that `main.py` still correctly calls `rds.fetch()` and writes results to DynamoDB with the expected schema
