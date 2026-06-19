"""Tests for ElastiCache, OpenSearch, and MSK EOL scrapers.

Focus areas:
- ElastiCache: must pick "End of Extended Support" column, NOT "Start of Extended Support"
- OpenSearch: version-range matching for ranges like "1.0 through 1.2", "2.11 and higher"
- MSK: end-of-support date extraction (no extended support tier)
"""
from unittest.mock import patch, MagicMock

from eol_scraper.scrapers import elasticache, opensearch, msk


# ============================================================================
# ElastiCache — "Start of Extended Support" trap avoidance
# ============================================================================

ELASTICACHE_HTML = """
<html><body>
<table>
<tr>
  <th>Major Engine Version</th>
  <th>End of Standard Support</th>
  <th>Start of Extended Support Y1 Premium</th>
  <th>Start of Extended Support Y2 Premium</th>
  <th>Start of Extended Support Y3 Premium</th>
  <th>End of Extended Support and version EOL</th>
</tr>
<tr><td>Redis OSS v4</td><td>1/31/2026</td><td>2/1/2026</td><td>2/1/2027</td><td>2/1/2028</td><td>1/31/2029</td></tr>
<tr><td>Redis OSS v6</td><td>1/31/2027</td><td>2/1/2027</td><td>2/1/2028</td><td>2/1/2029</td><td>1/31/2030</td></tr>
</table>
</body></html>
"""


class TestElastiCacheExtendedSupportColumn:
    @patch("eol_scraper.scrapers.elasticache.requests.get")
    def test_picks_end_of_extended_support_not_start(self, mock_get):
        """ext date must be the END column (1/31/2029), not the START column (2/1/2026)."""
        mock_resp = MagicMock()
        mock_resp.text = ELASTICACHE_HTML
        mock_get.return_value = mock_resp

        scraped = elasticache._scrape_eol_table()

        v4 = scraped[("redis", "4")]
        assert v4["end_of_standard_support"] == "2026-01-31"
        # Must be the END of extended support, NOT "2026-02-01" (the start/pricing column)
        assert v4["end_of_extended_support"] == "2029-01-31"

    @patch("eol_scraper.scrapers.elasticache.requests.get")
    def test_extended_support_has_multi_year_gap(self, mock_get):
        """The standard→extended gap should be multiple years, not a few days."""
        mock_resp = MagicMock()
        mock_resp.text = ELASTICACHE_HTML
        mock_get.return_value = mock_resp

        scraped = elasticache._scrape_eol_table()
        for (engine, major), dates in scraped.items():
            std_year = int(dates["end_of_standard_support"][:4])
            ext_year = int(dates["end_of_extended_support"][:4])
            assert ext_year - std_year >= 2, f"{engine} v{major} gap too small"


# ============================================================================
# OpenSearch — version range matching
# ============================================================================


class TestOpenSearchVersionMatching:
    def test_range_to(self):
        assert opensearch._version_matches("7.5", "Elasticsearch versions 7.1 to 7.8") is True
        assert opensearch._version_matches("7.10", "Elasticsearch versions 7.1 to 7.8") is False

    def test_range_through(self):
        assert opensearch._version_matches("1.1", "OpenSearch versions 1.0 through 1.2") is True
        assert opensearch._version_matches("1.3", "OpenSearch versions 1.0 through 1.2") is False

    def test_and_higher(self):
        assert opensearch._version_matches("2.17", "OpenSearch versions 2.11 and higher versions") is True
        assert opensearch._version_matches("2.10", "OpenSearch versions 2.11 and higher versions") is False

    def test_discrete_list(self):
        assert opensearch._version_matches("2.3", "Elasticsearch versions 1.5 and 2.3") is True
        assert opensearch._version_matches("1.5", "Elasticsearch versions 1.5 and 2.3") is True
        assert opensearch._version_matches("1.6", "Elasticsearch versions 1.5 and 2.3") is False

    def test_single_version(self):
        assert opensearch._version_matches("5.6", "Elasticsearch versions 5.6") is True
        assert opensearch._version_matches("5.5", "Elasticsearch versions 5.6") is False

    def test_not_announced_is_unknown(self):
        assert opensearch._extract_date("Not announced") == "Unknown"

    @patch("eol_scraper.scrapers.opensearch.boto3.client")
    @patch("eol_scraper.scrapers.opensearch.requests.get")
    def test_fetch_enriches_matching_version(self, mock_get, mock_boto):
        """An API version covered by a docs range gets the scraped dates."""
        mock_resp = MagicMock()
        mock_resp.text = """
        <html><body><table>
        <tr><th>Software Version</th><th>End of Standard Support</th><th>End of Extended Support</th></tr>
        <tr><td>OpenSearch versions 2.3 to 2.9</td><td>November 7, 2025</td><td>November 7, 2026</td></tr>
        </table></body></html>
        """
        mock_get.return_value = mock_resp

        client = MagicMock()
        client.list_versions.return_value = {"Versions": ["OpenSearch_2.5"]}
        mock_boto.return_value = client

        results = opensearch.fetch("us-east-1")
        os_25 = next(r for r in results if r["version"] == "2.5")
        assert os_25["end_of_standard_support"] == "2025-11-07"
        assert os_25["end_of_extended_support"] == "2026-11-07"


# ============================================================================
# MSK — end of support extraction
# ============================================================================

MSK_HTML = """
<html><body>
<table>
<tr><th>Apache Kafka version</th><th>MSK release date</th><th>End of support date</th></tr>
<tr><td>2.8.1</td><td>2021-09-30</td><td>2024-09-11</td></tr>
<tr><td>3.6.0</td><td>2023-11-15</td><td>2025-11-15</td></tr>
</table>
</body></html>
"""


class TestMSKScraper:
    @patch("eol_scraper.scrapers.msk.requests.get")
    def test_scrape_end_of_support(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.text = MSK_HTML
        mock_get.return_value = mock_resp

        dates = msk._scrape_eol_dates()
        assert dates["2.8.1"] == "2024-09-11"
        assert dates["3.6.0"] == "2025-11-15"

    @patch("eol_scraper.scrapers.msk.boto3.client")
    @patch("eol_scraper.scrapers.msk.requests.get")
    def test_fetch_enriches_and_sets_extended_na(self, mock_get, mock_boto):
        mock_resp = MagicMock()
        mock_resp.text = MSK_HTML
        mock_get.return_value = mock_resp

        client = MagicMock()
        client.get_compatible_kafka_versions.return_value = {
            "CompatibleKafkaVersions": [
                {"SourceVersion": "2.8.1", "TargetVersions": ["3.6.0"]},
            ]
        }
        mock_boto.return_value = client

        results = msk.fetch("us-east-1")
        v281 = next(r for r in results if r["version"] == "2.8.1")
        assert v281["end_of_standard_support"] == "2024-09-11"
        # MSK has no extended support tier
        assert v281["end_of_extended_support"] == "N/A"
