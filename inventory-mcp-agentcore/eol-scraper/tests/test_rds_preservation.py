"""Preservation property tests for RDS EOL scraper.

These tests lock in the EXISTING (unfixed) behavior that must be preserved:
- API versions always included in output regardless of scrape success
- Merge enrichment: scraped dates overwrite API record dates
- Unknown fallback: unmatched versions retain "Unknown" dates
- Scraped-only appended: items from scrape not in API are appended
- Schema consistency: all records have exactly 6 required keys

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
"""

import pytest
from unittest.mock import patch, MagicMock

from eol_scraper.scrapers.rds import fetch


# --- Sample HTML for MySQL EOL table ---
MYSQL_EOL_HTML = """
<html><body>
<table>
<tr>
  <th>Major version</th>
  <th>Community release date</th>
  <th>RDS release date</th>
  <th>End of standard support</th>
  <th>End of extended support</th>
</tr>
<tr>
  <td>8.0</td>
  <td>April 19, 2018</td>
  <td>October 23, 2018</td>
  <td>2026-07-31</td>
  <td>2028-07-31</td>
</tr>
<tr>
  <td>8.4</td>
  <td>April 30, 2024</td>
  <td>August 15, 2024</td>
  <td>2032-04-30</td>
  <td>2034-04-30</td>
</tr>
<tr>
  <td>5.7</td>
  <td>October 21, 2015</td>
  <td>November 18, 2015</td>
  <td>2024-02-29</td>
  <td>2025-02-28</td>
</tr>
</table>
</body></html>
"""

# Empty HTML page (simulates failed scrape or no matching table)
EMPTY_HTML = "<html><body><p>No tables here.</p></body></html>"

# HTML with table that doesn't match the header requirements
NON_MATCHING_TABLE_HTML = """
<html><body>
<table>
<tr><th>Name</th><th>Value</th></tr>
<tr><td>foo</td><td>bar</td></tr>
</table>
</body></html>
"""

REQUIRED_KEYS = {"service", "version", "end_of_standard_support", "end_of_extended_support", "status", "source"}


def _make_api_page(engine, versions, service):
    """Helper to create a mock paginator response page."""
    return {
        "DBEngineVersions": [
            {"MajorEngineVersion": v, "Status": "available", "Engine": engine}
            for v in versions
        ]
    }


def _mock_paginator(pages):
    """Create a mock paginator that yields the given pages."""
    paginator = MagicMock()
    paginator.paginate.return_value = pages
    return paginator


def _build_rds_client_mock(engine_versions_map):
    """Build a mock boto3 RDS client that returns configured versions per engine.

    engine_versions_map: dict mapping engine name -> list of version strings
    """
    client = MagicMock()

    def get_paginator_side_effect(operation):
        if operation == "describe_db_engine_versions":
            paginator = MagicMock()

            def paginate_side_effect(**kwargs):
                engine = kwargs.get("Engine", "")
                versions = engine_versions_map.get(engine, [])
                return [_make_api_page(engine, versions, engine)]

            paginator.paginate.side_effect = paginate_side_effect
            return paginator
        raise ValueError(f"Unknown operation: {operation}")

    client.get_paginator.side_effect = get_paginator_side_effect
    return client


# ============================================================================
# Test 1: API versions always included in output regardless of scrape success
# ============================================================================


class TestApiVersionsAlwaysIncluded:
    """Property: For rds-mysql (with a configured URL), all API versions appear
    in output regardless of whether scraping succeeds or fails."""

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_api_versions_included_when_scrape_succeeds(self, mock_get, mock_boto_client):
        """All API versions appear in output when scrape returns valid data."""
        # Setup: API returns mysql versions
        api_versions = {"mysql": ["5.7", "8.0", "8.4"],
                        "postgres": ["14", "15", "16"],
                        "aurora-mysql": ["3"],
                        "aurora-postgresql": ["15", "16"]}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        # Setup: scrape returns matching MySQL EOL data
        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # All API versions must appear in the results
        result_keys = {(r["service"], r["version"]) for r in results}
        for v in api_versions["mysql"]:
            assert ("rds-mysql", v) in result_keys
        for v in api_versions["postgres"]:
            assert ("rds-postgresql", v) in result_keys
        for v in api_versions["aurora-mysql"]:
            assert ("aurora-mysql", v) in result_keys
        for v in api_versions["aurora-postgresql"]:
            assert ("aurora-postgresql", v) in result_keys

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_api_versions_included_when_scrape_fails(self, mock_get, mock_boto_client):
        """All API versions still appear even when scraping returns no data."""
        api_versions = {"mysql": ["5.7", "8.0"],
                        "postgres": ["14", "15"],
                        "aurora-mysql": ["3"],
                        "aurora-postgresql": ["15"]}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        # Scrape returns empty page (no matching table)
        mock_response = MagicMock()
        mock_response.text = EMPTY_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # All API versions must still be present
        result_keys = {(r["service"], r["version"]) for r in results}
        for v in api_versions["mysql"]:
            assert ("rds-mysql", v) in result_keys
        for v in api_versions["postgres"]:
            assert ("rds-postgresql", v) in result_keys

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_api_versions_included_when_scrape_raises_exception(self, mock_get, mock_boto_client):
        """All API versions still appear even when scraping raises an exception."""
        api_versions = {"mysql": ["8.0", "8.4"],
                        "postgres": ["15"],
                        "aurora-mysql": ["3"],
                        "aurora-postgresql": ["16"]}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        # Scrape raises an exception
        mock_get.side_effect = Exception("Connection timeout")

        results = fetch("us-east-1")

        result_keys = {(r["service"], r["version"]) for r in results}
        for v in api_versions["mysql"]:
            assert ("rds-mysql", v) in result_keys


# ============================================================================
# Test 2: Merge enrichment - scraped dates overwrite API record dates
# ============================================================================


class TestMergeEnrichment:
    """Property: When a scraped record key matches an API record key, the API
    record's dates are overwritten with the scraped dates and source is updated."""

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_matching_version_gets_scraped_dates(self, mock_get, mock_boto_client):
        """API record enriched with scraped dates when version matches."""
        api_versions = {"mysql": ["8.0", "8.4", "5.7"],
                        "postgres": [],
                        "aurora-mysql": [],
                        "aurora-postgresql": []}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # Find the rds-mysql 8.0 record - should have scraped dates
        mysql_80 = next(r for r in results if r["service"] == "rds-mysql" and r["version"] == "8.0")
        assert mysql_80["end_of_standard_support"] == "2026-07-31"
        assert mysql_80["end_of_extended_support"] == "2028-07-31"
        assert mysql_80["source"] == "docs:rds-mysql"

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_multiple_versions_enriched(self, mock_get, mock_boto_client):
        """All matching versions get their dates overwritten."""
        api_versions = {"mysql": ["5.7", "8.0", "8.4"],
                        "postgres": [],
                        "aurora-mysql": [],
                        "aurora-postgresql": []}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # All three MySQL versions should have scraped dates
        mysql_results = [r for r in results if r["service"] == "rds-mysql"]
        for r in mysql_results:
            assert r["end_of_standard_support"] != "Unknown"
            assert r["end_of_extended_support"] != "Unknown"
            assert r["source"] == "docs:rds-mysql"

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_source_field_updated_on_merge(self, mock_get, mock_boto_client):
        """Source field changes from api:rds:mysql to docs:rds-mysql on merge."""
        api_versions = {"mysql": ["8.0"],
                        "postgres": [],
                        "aurora-mysql": [],
                        "aurora-postgresql": []}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        mysql_80 = next(r for r in results if r["service"] == "rds-mysql" and r["version"] == "8.0")
        # Source should be the docs source after merge, not api source
        assert mysql_80["source"] == "docs:rds-mysql"


# ============================================================================
# Test 3: Unknown fallback - unmatched versions retain "Unknown" dates
# ============================================================================


class TestUnknownFallback:
    """Property: Versions without matching scraped dates retain "Unknown" as their
    date values rather than being omitted or given arbitrary values."""

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_unmatched_version_has_unknown_dates(self, mock_get, mock_boto_client):
        """API version not found in scrape keeps Unknown dates."""
        # API returns a version that isn't in the HTML table
        api_versions = {"mysql": ["9.0"],  # 9.0 is NOT in our mock HTML
                        "postgres": ["15"],
                        "aurora-mysql": ["3"],
                        "aurora-postgresql": ["16"]}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # MySQL 9.0 should exist but with Unknown dates (not in scrape data)
        mysql_90 = next(r for r in results if r["service"] == "rds-mysql" and r["version"] == "9.0")
        assert mysql_90["end_of_standard_support"] == "Unknown"
        assert mysql_90["end_of_extended_support"] == "Unknown"

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_non_mysql_services_have_unknown_dates(self, mock_get, mock_boto_client):
        """API versions without matching scraped data retain Unknown dates."""
        api_versions = {"mysql": ["8.0"],
                        "postgres": ["14", "15"],
                        "aurora-mysql": ["3"],
                        "aurora-postgresql": ["15"],
                        "mariadb": ["10.6"]}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        # Return empty HTML so no scraping succeeds for any service
        mock_response = MagicMock()
        mock_response.text = EMPTY_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # Postgres, Aurora, MariaDB versions should have Unknown dates (scrape returned no data)
        postgres_results = [r for r in results if r["service"] == "rds-postgresql"]
        for r in postgres_results:
            assert r["end_of_standard_support"] == "Unknown"
            assert r["end_of_extended_support"] == "Unknown"

        aurora_mysql_results = [r for r in results if r["service"] == "aurora-mysql"]
        for r in aurora_mysql_results:
            assert r["end_of_standard_support"] == "Unknown"
            assert r["end_of_extended_support"] == "Unknown"

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_api_source_preserved_when_no_scrape_match(self, mock_get, mock_boto_client):
        """Source field stays as api:rds:... when version has no scrape match."""
        api_versions = {"mysql": ["9.0"],  # Not in HTML table
                        "postgres": ["15"],
                        "aurora-mysql": [],
                        "aurora-postgresql": []}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        mysql_90 = next(r for r in results if r["service"] == "rds-mysql" and r["version"] == "9.0")
        assert mysql_90["source"] == "api:rds:mysql"

        pg_15 = next(r for r in results if r["service"] == "rds-postgresql" and r["version"] == "15")
        assert pg_15["source"] == "api:rds:postgres"


# ============================================================================
# Test 4: Scraped-only items appended to results
# ============================================================================


class TestScrapedOnlyAppended:
    """Property: Scraped items not found in the API are appended to the results list."""

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_scraped_version_not_in_api_is_appended(self, mock_get, mock_boto_client):
        """A version present in scrape but NOT in API should appear in results."""
        # API does NOT return 5.7, but it IS in the HTML table
        api_versions = {"mysql": ["8.0", "8.4"],
                        "postgres": [],
                        "aurora-mysql": [],
                        "aurora-postgresql": []}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # 5.7 is in the HTML but not in API - should be appended
        result_keys = {(r["service"], r["version"]) for r in results}
        assert ("rds-mysql", "5.7") in result_keys

        # Verify the appended record has scraped dates
        mysql_57 = next(r for r in results if r["service"] == "rds-mysql" and r["version"] == "5.7")
        assert mysql_57["end_of_standard_support"] == "2024-02-29"
        assert mysql_57["end_of_extended_support"] == "2025-02-28"
        assert mysql_57["source"] == "docs:rds-mysql"

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_no_duplicates_when_version_in_both(self, mock_get, mock_boto_client):
        """A version present in both API and scrape should appear exactly once."""
        api_versions = {"mysql": ["8.0", "8.4", "5.7"],
                        "postgres": [],
                        "aurora-mysql": [],
                        "aurora-postgresql": []}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # Each (service, version) should appear exactly once
        mysql_80_count = sum(1 for r in results if r["service"] == "rds-mysql" and r["version"] == "8.0")
        assert mysql_80_count == 1

        mysql_57_count = sum(1 for r in results if r["service"] == "rds-mysql" and r["version"] == "5.7")
        assert mysql_57_count == 1


# ============================================================================
# Test 5: Schema consistency - all records have exactly 6 required keys
# ============================================================================


class TestSchemaConsistency:
    """Property: All output records have exactly the 6 required keys:
    service, version, end_of_standard_support, end_of_extended_support, status, source."""

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_all_records_have_required_keys_with_successful_scrape(self, mock_get, mock_boto_client):
        """Every record has exactly the 6 required keys when scrape succeeds."""
        api_versions = {"mysql": ["5.7", "8.0", "8.4"],
                        "postgres": ["14", "15", "16"],
                        "aurora-mysql": ["2", "3"],
                        "aurora-postgresql": ["14", "15", "16"]}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        assert len(results) > 0
        for record in results:
            assert set(record.keys()) == REQUIRED_KEYS, f"Record has unexpected keys: {record}"

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_all_records_have_required_keys_with_failed_scrape(self, mock_get, mock_boto_client):
        """Every record has exactly the 6 required keys even when scrape fails."""
        api_versions = {"mysql": ["8.0"],
                        "postgres": ["15"],
                        "aurora-mysql": ["3"],
                        "aurora-postgresql": ["16"]}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_get.side_effect = Exception("Network error")

        results = fetch("us-east-1")

        assert len(results) > 0
        for record in results:
            assert set(record.keys()) == REQUIRED_KEYS

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_scraped_only_records_have_required_keys(self, mock_get, mock_boto_client):
        """Scraped-only records (not in API) also have the correct schema."""
        # API doesn't have 5.7, but scrape does
        api_versions = {"mysql": ["8.0", "8.4"],
                        "postgres": [],
                        "aurora-mysql": [],
                        "aurora-postgresql": []}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        # Find the scraped-only record (5.7)
        mysql_57 = next(r for r in results if r["service"] == "rds-mysql" and r["version"] == "5.7")
        assert set(mysql_57.keys()) == REQUIRED_KEYS

    @patch("eol_scraper.scrapers.rds.boto3.client")
    @patch("eol_scraper.scrapers.rds.requests.get")
    def test_value_types_are_strings(self, mock_get, mock_boto_client):
        """All values in output records are strings."""
        api_versions = {"mysql": ["8.0", "8.4"],
                        "postgres": ["15"],
                        "aurora-mysql": ["3"],
                        "aurora-postgresql": ["16"]}
        mock_boto_client.return_value = _build_rds_client_mock(api_versions)

        mock_response = MagicMock()
        mock_response.text = MYSQL_EOL_HTML
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        results = fetch("us-east-1")

        for record in results:
            for key, value in record.items():
                assert isinstance(value, str), f"Key '{key}' has non-string value: {type(value)}"
