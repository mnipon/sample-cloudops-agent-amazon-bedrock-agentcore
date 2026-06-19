"""Tests for the shared verification module (eol_scraper.verification).

Focus on behaviors that matter for the non-RDS scrapers now routing through it:
- "N/A" sentinel is preserved (not reset to "Unknown")
- Deduplication is scoped per-service (same version across engines does NOT conflict)
- Multi-service input order is preserved
"""
import logging

from eol_scraper import verification


def _rec(service, version, std="Unknown", ext="Unknown"):
    return {
        "service": service,
        "version": version,
        "end_of_standard_support": std,
        "end_of_extended_support": ext,
        "status": "available",
        "source": "test",
    }


class TestSentinelHandling:
    def test_na_is_preserved(self):
        rec = _rec("msk", "3.6.0", std="2025-11-15", ext="N/A")
        out = verification.verify_service("msk", [rec])
        assert out[0]["end_of_extended_support"] == "N/A"

    def test_invalid_format_still_reset(self):
        rec = _rec("opensearch", "2.5", std="Nov 2025", ext="Unknown")
        out = verification.verify_service("opensearch", [rec])
        assert out[0]["end_of_standard_support"] == "Unknown"

    def test_na_not_flagged_as_invalid(self, caplog):
        rec = _rec("msk", "3.6.0", std="2025-11-15", ext="N/A")
        with caplog.at_level(logging.WARNING):
            verification.verify_service("msk", [rec])
        assert not any("invalid date format" in m.lower() for m in caplog.messages)


class TestCrossEngineDedup:
    def test_same_version_different_service_no_conflict(self, caplog):
        """redis 7.0 and valkey 7.0 must not be treated as duplicates."""
        records = [
            _rec("elasticache-redis", "7.0", std="2026-01-31", ext="2029-01-31"),
            _rec("elasticache-valkey", "7.0", std="2027-01-31", ext="2030-01-31"),
        ]
        with caplog.at_level(logging.WARNING):
            out = verification.verify_records(records)
        assert len(out) == 2
        assert not any("conflicting" in m.lower() for m in caplog.messages)

    def test_same_version_same_service_conflict_keeps_first(self, caplog):
        records = [
            _rec("elasticache-redis", "7.0", std="2026-01-31", ext="2029-01-31"),
            _rec("elasticache-redis", "7.0", std="2026-12-31", ext="2029-12-31"),
        ]
        with caplog.at_level(logging.WARNING):
            out = verification.verify_records(records)
        redis_70 = [r for r in out if r["version"] == "7.0"]
        assert len(redis_70) == 1
        assert redis_70[0]["end_of_standard_support"] == "2026-01-31"
        assert any("conflicting" in m.lower() for m in caplog.messages)


class TestMultiServiceOrder:
    def test_order_preserved(self):
        records = [
            _rec("opensearch", "2.17", std="2025-11-07", ext="2026-11-07"),
            _rec("elasticsearch", "7.10", std="Unknown", ext="Unknown"),
            _rec("opensearch", "2.11", std="Unknown", ext="Unknown"),
        ]
        out = verification.verify_records(records)
        services = [r["service"] for r in out]
        # opensearch group emitted first (first-seen), then elasticsearch
        assert services == ["opensearch", "opensearch", "elasticsearch"]
        assert len(out) == 3


class TestWarnAndContinue:
    def test_never_raises(self):
        # Malformed record missing fields should not crash verify_records
        records = [{"service": "x", "version": "1.0"}]
        out = verification.verify_records(records)
        assert len(out) == 1
