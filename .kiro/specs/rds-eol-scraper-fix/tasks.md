# Implementation Plan

## Overview

Fix the RDS EOL scraper to support all 5 RDS/Aurora engine families by expanding DOC_URLS, generalizing table header detection, adding MariaDB to the API fetch, updating the scraping loop to handle URL lists, and implementing a runtime verification loop that validates scraped data quality before writing to DynamoDB. Uses the bug condition methodology: write exploration tests first to confirm the bug, write preservation tests to lock existing behavior, then implement the fix.

## Tasks

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Multi-Engine EOL Dates Missing
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate non-MySQL engines return "Unknown" dates
  - **Scoped PBT Approach**: Scope the property to each engine that lacks DOC_URLS entries (rds-postgresql, aurora-mysql, aurora-postgresql, rds-mariadb)
  - Test file: `inventory-mcp-agentcore/eol-scraper/tests/test_rds_bugfix.py`
  - Mock `requests.get` to return realistic HTML table content for each engine's documentation page
  - Mock `boto3.client` to return sample versions for all engines from DescribeDBEngineVersions
  - Property: For any service in ['rds-postgresql', 'aurora-mysql', 'aurora-postgresql', 'rds-mariadb'], calling `fetch(region)` SHALL return at least one record with `end_of_standard_support != "Unknown"` for that service
  - The test assertions match Expected Behavior Properties from design (Requirements 2.1, 2.2, 2.3, 2.4)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves non-MySQL engines get no scraped dates)
  - Document counterexamples found: e.g., "rds-postgresql returns 0 records with dates, aurora-mysql returns 0 records with dates"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - API Fetch and Merge Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Test file: `inventory-mcp-agentcore/eol-scraper/tests/test_rds_preservation.py`
  - Observe on UNFIXED code: `_fetch_from_api` returns records for mysql, postgres, aurora-mysql, aurora-postgresql with schema {service, version, end_of_standard_support, end_of_extended_support, status, source}
  - Observe on UNFIXED code: merge logic enriches API records when scraped key matches, keeps "Unknown" otherwise
  - Observe on UNFIXED code: scraped-only items are appended to results
  - Observe on UNFIXED code: all output records have exactly keys {service, version, end_of_standard_support, end_of_extended_support, status, source}
  - Write property-based tests (using hypothesis or parameterized inputs) that verify:
    - For all non-buggy inputs (rds-mysql with a configured URL), API versions are always included in output regardless of scrape success
    - When a scraped record key matches an API record key, the API record's dates are overwritten and source updated
    - Versions without matching scraped dates retain "Unknown" as their date values
    - Scraped items not found in API are appended to the results list
    - All output records have exactly the 6 required keys: service, version, end_of_standard_support, end_of_extended_support, status, source
  - Mock `requests.get` with sample MySQL HTML tables and `boto3.client` with sample API responses
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix for RDS EOL scraper multi-engine support
  - [ ] 3.1 Expand DOC_URLS dictionary to cover all 5 engine families
    - Change DOC_URLS from single-URL strings to lists of URLs per service
    - Add rds-postgresql URLs (release calendar + versions page)
    - Add aurora-mysql URL (release calendar)
    - Add aurora-postgresql URL (release calendar)
    - Add rds-mariadb URL (version management)
    - Convert existing rds-mysql entry from string to list format
    - _Bug_Condition: isBugCondition(input) where input.service IN ['rds-postgresql', 'aurora-mysql', 'aurora-postgresql', 'rds-mariadb']_
    - _Expected_Behavior: Each configured service has at least one documentation URL to scrape_
    - _Preservation: Existing rds-mysql URL remains functional_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.2 Generalize table header detection in \_scrape_major_version_table
    - Relax header matching to accept tables with "version" (not just "major version") in any header
    - Accept tables with "end of" or "standard support" or "extended support" in header text
    - Handle version column flexibility: extract version from first cell regardless of header name
    - Add positional fallback for date columns when header-based indexing fails
    - _Bug_Condition: Different doc pages use different table header formats (e.g., "Community release date", "Release" columns)_
    - _Expected_Behavior: Parser correctly extracts version/date pairs from all engine documentation table formats_
    - _Preservation: Existing MySQL table parsing continues to work with the relaxed matching_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.3 Add MariaDB to \_fetch_from_api engine list
    - Add `("mariadb", "rds-mariadb")` to the engine loop in `_fetch_from_api`
    - MariaDB versions will be fetched via DescribeDBEngineVersions like other engines
    - _Bug_Condition: MariaDB not queried from API, so no rds-mariadb records exist_
    - _Expected_Behavior: API returns MariaDB major versions with status_
    - _Preservation: Existing engine queries (mysql, postgres, aurora-mysql, aurora-postgresql) remain unchanged_
    - _Requirements: 1.4, 2.4, 3.1_

  - [ ] 3.4 Update the scraping loop in fetch() to handle URL lists per service
    - Change iteration from `for service, url in DOC_URLS.items()` to handle lists of URLs
    - For each service, iterate all URLs in the list and accumulate scraped results
    - Later URLs should not overwrite earlier results for the same (service, version) key
    - _Bug_Condition: Current loop expects single URL string per service_
    - _Expected_Behavior: Loop processes all URLs for each service, merging results_
    - _Preservation: Merge logic after scraping remains unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.4_

  - [ ] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Multi-Engine EOL Dates Populated
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (non-MySQL engines return scraped dates)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed for all affected engines)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - API Fetch and Merge Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in API fetch, merge logic, schema)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Implement runtime verification loop
  - [ ] 4.1 Implement `_verify_scraped_data()` function scaffold
    - Create the `_verify_scraped_data(service, scraped_results, api_data)` function in `rds.py`
    - Function accepts the service name, scraped results for that service, and the full API data
    - Function returns the (possibly modified) scraped_results list after running all checks
    - Add environment variable reads for configuration: `EOL_COVERAGE_THRESHOLD` (default 0.50), `EOL_MIN_YEAR` (default 2020), `EOL_MAX_YEAR` (default 2035)
    - _Requirements: 4.6, 4.7_

  - [ ] 4.2 Implement date format validation check
    - Inside `_verify_scraped_data()`, validate all date fields match `YYYY-MM-DD` format using regex `^\d{4}-\d{2}-\d{2}$`
    - Skip values that are "Unknown" (those are expected)
    - For invalid date formats: log a warning with service, version, field name, and invalid value
    - Reset the invalid date field to "Unknown"
    - _Requirements: 4.1_

  - [ ] 4.3 Implement chronological sanity check
    - Inside `_verify_scraped_data()`, for records where both `end_of_standard_support` and `end_of_extended_support` are valid (not "Unknown")
    - Compare date strings directly (string comparison works for YYYY-MM-DD format)
    - If `end_of_extended_support < end_of_standard_support`: log a warning with service, version, and both date values
    - Do NOT reset or modify the dates (they may reflect real upstream documentation errors)
    - _Requirements: 4.2_

  - [ ] 4.4 Implement coverage threshold check
    - Inside `_verify_scraped_data()`, count how many API-known versions for the current service received non-"Unknown" dates from scraping
    - Filter `api_data` to versions matching the current service
    - Calculate coverage = versions_with_dates / total_api_versions
    - If coverage < threshold (from `EOL_COVERAGE_THRESHOLD` env var, default 0.50): log a warning indicating potential documentation page structure changes
    - If no API versions exist for this service, skip the check (return True)
    - Do NOT halt or modify data — this is informational only
    - _Requirements: 4.3_

  - [ ] 4.5 Implement date range plausibility check
    - Inside `_verify_scraped_data()`, validate all non-"Unknown" date values have years within the plausible range
    - Read min/max year from `EOL_MIN_YEAR` (default 2020) and `EOL_MAX_YEAR` (default 2035) environment variables
    - Extract year as `int(value[0:4])` for each date field
    - If year < min_year or year > max_year: log a warning and reset the date field to "Unknown"
    - _Requirements: 4.4_

  - [ ] 4.6 Implement cross-service deduplication check
    - Inside `_verify_scraped_data()`, check for conflicting dates from different source URLs for the same (service, version) key
    - Track seen versions in a dict: version → first scraped record
    - For subsequent records with the same version: compare `end_of_standard_support` and `end_of_extended_support`
    - If conflicting (both non-"Unknown" but different): log a warning and retain the first-seen value (discard the later entry)
    - This aligns with the "earlier URL takes priority" rule from task 3.4
    - _Requirements: 4.5_

  - [ ] 4.7 Integrate verification loop into fetch() function
    - In `fetch()`, call `_verify_scraped_data(service, service_scraped, api_data)` after scraping all URLs for a service but before populating the `scraped` dict
    - Pass the accumulated `service_scraped` list and full `api_data` list
    - Use the returned (potentially modified) list to populate the `scraped` dict
    - Ensure the verification loop never raises exceptions that halt the scraper
    - Wrap the verification call in a try/except that logs unexpected errors and continues
    - _Requirements: 4.6, 4.7_

- [ ] 5. Write unit tests for runtime verification loop
  - [ ] 5.1 Write tests for date format validation (requirement 4.1)
    - Test file: `inventory-mcp-agentcore/eol-scraper/tests/test_rds_verification.py`
    - Test valid YYYY-MM-DD dates pass without modification
    - Test "Unknown" values are not flagged
    - Test invalid formats (e.g., "March 2025", "2025/03/01", "garbage", "") are reset to "Unknown"
    - Test that a warning is logged for each invalid date
    - _Requirements: 4.1_

  - [ ] 5.2 Write tests for chronological sanity check (requirement 4.2)
    - Test that records with `end_of_extended_support >= end_of_standard_support` pass silently
    - Test that records with `end_of_extended_support < end_of_standard_support` log a warning
    - Test that inverted dates are NOT modified (preserved as-is)
    - Test that records with one or both dates as "Unknown" are skipped
    - _Requirements: 4.2_

  - [ ] 5.3 Write tests for coverage threshold check (requirement 4.3)
    - Test that coverage above threshold (e.g., 3/5 = 60% > 50%) produces no warning
    - Test that coverage below threshold (e.g., 1/5 = 20% < 50%) produces a warning
    - Test that coverage with 0 API versions for the service skips the check
    - Test that custom threshold from environment variable is respected
    - _Requirements: 4.3_

  - [ ] 5.4 Write tests for date range plausibility check (requirement 4.4)
    - Test that dates within range (2020-2035) pass without modification
    - Test that dates before min year (e.g., "0202-03-01", "2019-12-31") are reset to "Unknown"
    - Test that dates after max year (e.g., "2036-01-01", "9999-12-31") are reset to "Unknown"
    - Test that custom min/max year from environment variables is respected
    - Test that "Unknown" values are not affected
    - _Requirements: 4.4_

  - [ ] 5.5 Write tests for cross-service deduplication check (requirement 4.5)
    - Test that unique versions pass without warnings
    - Test that duplicate versions with identical dates produce no warning
    - Test that duplicate versions with conflicting non-"Unknown" dates log a warning and retain first-seen value
    - Test that duplicate versions where one has "Unknown" and the other has a date do NOT conflict (no warning)
    - _Requirements: 4.5_

  - [ ] 5.6 Write integration test for full verification loop (requirements 4.6, 4.7)
    - Test that when all checks pass, scraped data is returned unmodified
    - Test that when checks produce warnings, the function does NOT raise exceptions
    - Test that the warn-and-continue philosophy holds: scraping continues even with multiple warnings
    - Test end-to-end: pass data with mixed issues (invalid dates, inverted chronology, implausible years) and verify all checks run and appropriate modifications are applied
    - _Requirements: 4.6, 4.7_

- [ ] 6. Checkpoint - Ensure all tests pass
  - Run the full test suite to confirm exploration, preservation, and verification loop tests all pass
  - Verify no other scrapers (eks, elasticache, opensearch, msk) are broken by the changes
  - Verify the verification loop runs without halting when warnings occur
  - Ensure all tests pass, ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    ["1", "2"],
    ["3.1"],
    ["3.2"],
    ["3.3"],
    ["3.4"],
    ["3.5", "3.6"],
    ["4.1"],
    ["4.2", "4.3", "4.4", "4.5", "4.6"],
    ["4.7"],
    ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6"],
    ["6"]
  ]
}
```

## Notes

- Tasks 1 and 2 are independent and can be done in parallel, but both must complete BEFORE task 3 implementation begins
- The exploration test (task 1) is expected to FAIL on unfixed code - this is correct behavior that proves the bug exists
- The preservation tests (task 2) are expected to PASS on unfixed code - this locks in baseline behavior
- After the fix (task 3.1-3.4), task 3.5 re-runs the exploration test expecting it to PASS
- After the fix, task 3.6 re-runs the preservation tests expecting them to still PASS
- Task 4 (verification loop) can begin after task 3.4 completes since it integrates into the updated fetch() function
- Task 5 (verification loop tests) can run in parallel with task 4 sub-tasks or after they complete
- The verification loop follows a warn-and-continue philosophy: it never halts the scraper
- Configuration is via environment variables: `EOL_COVERAGE_THRESHOLD`, `EOL_MIN_YEAR`, `EOL_MAX_YEAR`
- File under test: `inventory-mcp-agentcore/eol-scraper/eol_scraper/scrapers/rds.py`
