"""Tests for _verify_scraped_data() runtime verification loop in eol_scraper.scrapers.rds.

Covers:
- Task 5.1: Date format validation (requirement 4.1)
- Task 5.2: Chronological sanity check (requirement 4.2)
- Task 5.3: Coverage threshold check (requirement 4.3)
- Task 5.4: Date range plausibility (requirement 4.4)
- Task 5.5: Cross-service deduplication (requirement 4.5)
- Task 5.6: Integration test for full verification loop (requirements 4.6, 4.7)
"""

import logging
import pytest

from eol_scraper.scrapers.rds import _verify_scraped_data


def _make_record(version="8.0", std="2025-06-30", ext="2028-06-30", service="rds-mysql"):
    """Helper to build a scraped record dict."""
    return {
        "service": service,
        "version": version,
        "end_of_standard_support": std,
        "end_of_extended_support": ext,
        "status": "available",
        "source": f"docs:{service}",
    }


def _make_api_record(version="8.0", service="rds-mysql"):
    """Helper to build an API record dict."""
    return {
        "service": service,
        "version": version,
        "end_of_standard_support": "Unknown",
        "end_of_extended_support": "Unknown",
        "status": "available",
        "source": f"api:rds:mysql",
    }


# ============================================================================
# Task 5.1: Date format validation tests (requirement 4.1)
# ============================================================================


class TestDateFormatValidation:
    """Validates: Requirements 4.1"""

    def test_valid_dates_pass_without_modification(self):
        """Valid YYYY-MM-DD dates should pass through unchanged."""
        record = _make_record(std="2025-06-30", ext="2028-06-30")
        result = _verify_scraped_data("rds-mysql", [record], [])
        assert result[0]["end_of_standard_support"] == "2025-06-30"
        assert result[0]["end_of_extended_support"] == "2028-06-30"

    def test_unknown_values_not_flagged(self):
        """'Unknown' values should not be flagged or modified."""
        record = _make_record(std="Unknown", ext="Unknown")
        result = _verify_scraped_data("rds-mysql", [record], [])
        assert result[0]["end_of_standard_support"] == "Unknown"
        assert result[0]["end_of_extended_support"] == "Unknown"

    @pytest.mark.parametrize("invalid_date", [
        "March 2025",
        "2025/03/01",
        "garbage",
        "",
    ])
    def test_invalid_formats_reset_to_unknown(self, invalid_date):
        """Invalid date formats should be reset to 'Unknown'."""
        record = _make_record(std=invalid_date, ext="2028-06-30")
        result = _verify_scraped_data("rds-mysql", [record], [])
        assert result[0]["end_of_standard_support"] == "Unknown"

    @pytest.mark.parametrize("invalid_date", [
        "March 2025",
        "2025/03/01",
        "garbage",
        "",
    ])
    def test_warning_logged_for_invalid_date(self, invalid_date, caplog):
        """A warning should be logged for each invalid date."""
        record = _make_record(std=invalid_date, ext="2028-06-30")
        with caplog.at_level(logging.WARNING):
            _verify_scraped_data("rds-mysql", [record], [])
        assert any("invalid date format" in msg.lower() for msg in caplog.messages)


# ============================================================================
# Task 5.2: Chronological sanity check tests (requirement 4.2)
# ============================================================================


class TestChronologicalSanityCheck:
    """Validates: Requirements 4.2"""

    def test_extended_gte_standard_passes_silently(self, caplog):
        """Records with end_of_extended_support >= end_of_standard_support should pass."""
        record = _make_record(std="2025-06-30", ext="2028-06-30")
        with caplog.at_level(logging.WARNING):
            _verify_scraped_data("rds-mysql", [record], [])
        # No chronological warning should be logged
        assert not any("end_of_extended_support" in msg and "<" in msg for msg in caplog.messages)

    def test_inverted_dates_log_warning(self, caplog):
        """Records with end_of_extended_support < end_of_standard_support should log a warning."""
        record = _make_record(std="2028-06-30", ext="2025-06-30")
        with caplog.at_level(logging.WARNING):
            _verify_scraped_data("rds-mysql", [record], [])
        assert any(
            "end_of_extended_support" in msg and "end_of_standard_support" in msg
            for msg in caplog.messages
        )

    def test_inverted_dates_not_modified(self):
        """Inverted dates should be preserved as-is (not reset)."""
        record = _make_record(std="2028-06-30", ext="2025-06-30")
        result = _verify_scraped_data("rds-mysql", [record], [])
        assert result[0]["end_of_standard_support"] == "2028-06-30"
        assert result[0]["end_of_extended_support"] == "2025-06-30"

    def test_unknown_dates_skipped(self, caplog):
        """Records with one or both dates as 'Unknown' should be skipped."""
        records = [
            _make_record(version="8.0", std="Unknown", ext="2028-06-30"),
            _make_record(version="5.7", std="2025-06-30", ext="Unknown"),
            _make_record(version="8.4", std="Unknown", ext="Unknown"),
        ]
        with caplog.at_level(logging.WARNING):
            _verify_scraped_data("rds-mysql", records, [])
        # No chronological warnings for these records
        assert not any(
            "end_of_extended_support" in msg and "<" in msg and "end_of_standard_support" in msg
            for msg in caplog.messages
        )


# ============================================================================
# Task 5.3: Coverage threshold check tests (requirement 4.3)
# ============================================================================


class TestCoverageThresholdCheck:
    """Validates: Requirements 4.3"""

    def test_coverage_above_threshold_no_warning(self, caplog):
        """Coverage above threshold should produce no warning."""
        # 3 scraped records with dates out of 5 API versions = 60% > 50% threshold
        scraped = [
            _make_record(version="8.0", std="2025-06-30", ext="2028-06-30"),
            _make_record(version="5.7", std="2024-02-01", ext="2027-02-01"),
            _make_record(version="8.4", std="2026-01-15", ext="2029-01-15"),
        ]
        api_data = [_make_api_record(v) for v in ["8.0", "5.7", "8.4", "5.6", "8.1"]]
        with caplog.at_level(logging.WARNING):
            _verify_scraped_data("rds-mysql", scraped, api_data)
        assert not any("coverage" in msg.lower() or "doc page structure" in msg.lower() for msg in caplog.messages)

    def test_coverage_below_threshold_produces_warning(self, caplog):
        """Coverage below threshold should produce a warning."""
        # 1 scraped record with dates out of 5 API versions = 20% < 50% threshold
        scraped = [
            _make_record(version="8.0", std="2025-06-30", ext="2028-06-30"),
        ]
        api_data = [_make_api_record(v) for v in ["8.0", "5.7", "8.4", "5.6", "8.1"]]
        with caplog.at_level(logging.WARNING):
            _verify_scraped_data("rds-mysql", scraped, api_data)
        assert any("doc page structure" in msg.lower() for msg in caplog.messages)

    def test_zero_api_versions_skips_check(self, caplog):
        """Coverage check with 0 API versions for the service should be skipped."""
        scraped = [_make_record(version="8.0", std="2025-06-30", ext="2028-06-30")]
        # API data for a different service, so 0 versions match
        api_data = [_make_api_record(v, service="aurora-mysql") for v in ["2", "3"]]
        with caplog.at_level(logging.WARNING):
            _verify_scraped_data("rds-mysql", scraped, api_data)
        assert not any("doc page structure" in msg.lower() for msg in caplog.messages)

    def test_custom_threshold_from_env(self, monkeypatch, caplog):
        """Custom threshold from environment variable should be respected."""
        # Set threshold to 0.80 (80%)
        monkeypatch.setenv("EOL_COVERAGE_THRESHOLD", "0.80")
        # 3 scraped out of 5 API = 60% < 80% threshold → should warn
        scraped = [
            _make_record(version="8.0", std="2025-06-30", ext="2028-06-30"),
            _make_record(version="5.7", std="2024-02-01", ext="2027-02-01"),
            _make_record(version="8.4", std="2026-01-15", ext="2029-01-15"),
        ]
        api_data = [_make_api_record(v) for v in ["8.0", "5.7", "8.4", "5.6", "8.1"]]
        with caplog.at_level(logging.WARNING):
            _verify_scraped_data("rds-mysql", scraped, api_data)
        assert any("doc page structure" in msg.lower() for msg in caplog.messages)


# ============================================================================
# Task 5.4: Date range plausibility tests (requirement 4.4)
# ============================================================================


class TestDateRangePlausibility:
    """Validates: Requirements 4.4"""

    def test_dates_within_range_pass(self):
        """Dates within 2020-2035 range should pass without modification."""
        record = _make_record(std="2025-06-30", ext="2028-06-30")
        result = _verify_scraped_data("rds-mysql", [record], [])
        assert result[0]["end_of_standard_support"] == "2025-06-30"
        assert result[0]["end_of_extended_support"] == "2028-06-30"

    @pytest.mark.parametrize("implausible_date", [
        "0202-03-01",
        "2019-12-31",
    ])
    def test_dates_before_min_year_reset_to_unknown(self, implausible_date):
        """Dates before min year should be reset to 'Unknown'."""
        record = _make_record(std=implausible_date, ext="2028-06-30")
        result = _verify_scraped_data("rds-mysql", [record], [])
        assert result[0]["end_of_standard_support"] == "Unknown"

    @pytest.mark.parametrize("implausible_date", [
        "2036-01-01",
        "9999-12-31",
    ])
    def test_dates_after_max_year_reset_to_unknown(self, implausible_date):
        """Dates after max year should be reset to 'Unknown'."""
        record = _make_record(std="2025-06-30", ext=implausible_date)
        result = _verify_scraped_data("rds-mysql", [record], [])
        assert result[0]["end_of_extended_support"] == "Unknown"

    def test_custom_min_max_year_from_env(self, monkeypatch):
        """Custom min/max year from environment variables should be respected."""
        monkeypatch.setenv("EOL_MIN_YEAR", "2022")
        monkeypatch.setenv("EOL_MAX_YEAR", "2030")
        # 2021 is now below min → reset
        record_below = _make_record(version="5.7", std="2021-06-30", ext="2028-06-30")
        # 2031 is now above max → reset
        record_above = _make_record(version="8.0", std="2025-06-30", ext="2031-01-01")
        result = _verify_scraped_data("rds-mysql", [record_below, record_above], [])
        assert result[0]["end_of_standard_support"] == "Unknown"
        assert result[1]["end_of_extended_support"] == "Unknown"

    def test_unknown_values_not_affected(self):
        """'Unknown' values should not be affected by plausibility check."""
        record = _make_record(std="Unknown", ext="Unknown")
        result = _verify_scraped_data("rds-mysql", [record], [])
        assert result[0]["end_of_standard_support"] == "Unknown"
        assert result[0]["end_of_extended_support"] == "Unknown"


# ============================================================================
# Task 5.5: Cross-service deduplication tests (requirement 4.5)
# ============================================================================


class TestCrossServiceDeduplication:
    """Validates: Requirements 4.5"""

    def test_unique_versions_pass_without_warnings(self, caplog):
        """Unique versions should pass without any deduplication warnings."""
        scraped = [
            _make_record(version="8.0", std="2025-06-30", ext="2028-06-30"),
            _make_record(version="5.7", std="2024-02-01", ext="2027-02-01"),
        ]
        with caplog.at_level(logging.WARNING):
            result = _verify_scraped_data("rds-mysql", scraped, [])
        assert len(result) == 2
        assert not any("conflicting" in msg.lower() for msg in caplog.messages)

    def test_duplicate_versions_identical_dates_no_warning(self, caplog):
        """Duplicate versions with identical dates should produce no warning."""
        scraped = [
            _make_record(version="8.0", std="2025-06-30", ext="2028-06-30"),
            _make_record(version="8.0", std="2025-06-30", ext="2028-06-30"),
        ]
        with caplog.at_level(logging.WARNING):
            result = _verify_scraped_data("rds-mysql", scraped, [])
        assert not any("conflicting" in msg.lower() for msg in caplog.messages)

    def test_duplicate_versions_conflicting_dates_log_warning_retain_first(self, caplog):
        """Duplicate versions with conflicting dates should log a warning and retain first-seen."""
        scraped = [
            _make_record(version="8.0", std="2025-06-30", ext="2028-06-30"),
            _make_record(version="8.0", std="2025-12-31", ext="2029-01-01"),
        ]
        with caplog.at_level(logging.WARNING):
            result = _verify_scraped_data("rds-mysql", scraped, [])
        assert any("conflicting" in msg.lower() for msg in caplog.messages)
        # First-seen value is retained
        matching = [r for r in result if r["version"] == "8.0"]
        assert len(matching) == 1
        assert matching[0]["end_of_standard_support"] == "2025-06-30"
        assert matching[0]["end_of_extended_support"] == "2028-06-30"

    def test_duplicate_unknown_and_date_no_conflict(self, caplog):
        """Duplicate versions where one has 'Unknown' and the other a date should NOT conflict."""
        scraped = [
            _make_record(version="8.0", std="2025-06-30", ext="Unknown"),
            _make_record(version="8.0", std="Unknown", ext="2028-06-30"),
        ]
        with caplog.at_level(logging.WARNING):
            result = _verify_scraped_data("rds-mysql", scraped, [])
        assert not any("conflicting" in msg.lower() for msg in caplog.messages)


# ============================================================================
# Task 5.6: Integration test for full verification loop (requirements 4.6, 4.7)
# ============================================================================


class TestVerificationLoopIntegration:
    """Validates: Requirements 4.6, 4.7"""

    def test_all_checks_pass_data_unmodified(self):
        """When all checks pass, scraped data should be returned unmodified."""
        scraped = [
            _make_record(version="8.0", std="2025-06-30", ext="2028-06-30"),
            _make_record(version="5.7", std="2024-02-01", ext="2027-02-01"),
        ]
        api_data = [_make_api_record(v) for v in ["8.0", "5.7"]]
        result = _verify_scraped_data("rds-mysql", scraped, api_data)
        assert len(result) == 2
        assert result[0]["end_of_standard_support"] == "2025-06-30"
        assert result[0]["end_of_extended_support"] == "2028-06-30"
        assert result[1]["end_of_standard_support"] == "2024-02-01"
        assert result[1]["end_of_extended_support"] == "2027-02-01"

    def test_warnings_do_not_raise_exceptions(self, caplog):
        """When checks produce warnings, the function should NOT raise exceptions."""
        scraped = [
            # Invalid date format
            _make_record(version="8.0", std="garbage", ext="2028-06-30"),
            # Inverted chronology
            _make_record(version="5.7", std="2028-06-30", ext="2025-06-30"),
        ]
        with caplog.at_level(logging.WARNING):
            # Should not raise
            result = _verify_scraped_data("rds-mysql", scraped, [])
        assert result is not None
        assert len(result) == 2

    def test_warn_and_continue_philosophy(self, caplog):
        """Verification should continue even after multiple warnings."""
        scraped = [
            _make_record(version="8.0", std="bad-date", ext="2028-06-30"),
            _make_record(version="5.7", std="2028-12-31", ext="2025-01-01"),
            _make_record(version="8.4", std="2025-06-30", ext="2028-06-30"),
        ]
        with caplog.at_level(logging.WARNING):
            result = _verify_scraped_data("rds-mysql", scraped, [])
        # All 3 records should still be returned (processing did not halt)
        assert len(result) == 3
        # Warnings were logged
        assert len(caplog.messages) >= 2

    def test_end_to_end_mixed_issues(self, caplog):
        """End-to-end: mixed issues should be handled with appropriate modifications."""
        scraped = [
            # Invalid date format → reset to Unknown
            _make_record(version="8.0", std="March 2025", ext="2028-06-30"),
            # Implausible year → reset to Unknown
            _make_record(version="5.7", std="2025-06-30", ext="0202-03-01"),
            # Inverted chronology → preserved but warned
            _make_record(version="8.4", std="2029-01-01", ext="2026-01-01"),
            # Duplicate conflicting → second discarded
            _make_record(version="8.4", std="2030-01-01", ext="2033-01-01"),
            # Perfectly valid record
            _make_record(version="5.6", std="2024-01-15", ext="2027-01-15"),
        ]
        api_data = [_make_api_record(v) for v in ["8.0", "5.7", "8.4", "5.6"]]

        with caplog.at_level(logging.WARNING):
            result = _verify_scraped_data("rds-mysql", scraped, api_data)

        # Check: invalid date format was reset
        r_8_0 = next(r for r in result if r["version"] == "8.0")
        assert r_8_0["end_of_standard_support"] == "Unknown"
        assert r_8_0["end_of_extended_support"] == "2028-06-30"

        # Check: implausible year was reset
        r_5_7 = next(r for r in result if r["version"] == "5.7")
        assert r_5_7["end_of_extended_support"] == "Unknown"

        # Check: inverted dates preserved
        r_8_4 = next(r for r in result if r["version"] == "8.4")
        assert r_8_4["end_of_standard_support"] == "2029-01-01"
        assert r_8_4["end_of_extended_support"] == "2026-01-01"

        # Check: conflicting duplicate was discarded (only one 8.4 record remains)
        r_8_4_all = [r for r in result if r["version"] == "8.4"]
        assert len(r_8_4_all) == 1

        # Check: valid record unmodified
        r_5_6 = next(r for r in result if r["version"] == "5.6")
        assert r_5_6["end_of_standard_support"] == "2024-01-15"
        assert r_5_6["end_of_extended_support"] == "2027-01-15"

        # Verify warnings were logged
        assert len(caplog.messages) >= 3
