"""Shared runtime verification loop for scraped EOL data.

Validates scraped end-of-support dates before they are written to DynamoDB.
Follows a warn-and-continue philosophy: issues are logged but never halt the
scraper. Used by all scrapers (RDS, ElastiCache, OpenSearch, MSK).

Checks performed:
  1. Date format validation   — reset non-YYYY-MM-DD values to "Unknown"
  2. Date range plausibility   — reset implausible years to "Unknown"
  3. Chronological sanity       — warn if extended < standard support
  4. Coverage threshold         — warn if too few API versions got dates (opt-in)
  5. Cross-source deduplication — keep first-seen on conflicting dates

Sentinel values ("Unknown", "N/A") are treated as "no date" and skipped by the
format/range checks. "N/A" specifically means a support tier does not apply
(e.g., MSK has no extended support).
"""
import os
import re
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

# Values that represent "no concrete date" — never flagged as invalid formats.
SENTINELS = {"Unknown", "N/A"}

DATE_FIELDS = ("end_of_standard_support", "end_of_extended_support")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _config():
    return (
        float(os.environ.get("EOL_COVERAGE_THRESHOLD", "0.50")),
        int(os.environ.get("EOL_MIN_YEAR", "2020")),
        int(os.environ.get("EOL_MAX_YEAR", "2035")),
    )


def verify_service(service: str, records: list[dict], api_data: list[dict] | None = None) -> list[dict]:
    """Run all verification checks for a single service's records.

    Args:
        service: service name (e.g. "rds-mysql", "opensearch").
        records: scraped/enriched records for this service.
        api_data: optional full API record list; when provided, a coverage
                  threshold check is run (warns if too few versions got dates).

    Returns:
        The (possibly modified and deduplicated) records list.
    """
    coverage_threshold, min_year, max_year = _config()

    # --- 1. Date format validation ---
    for record in records:
        for field in DATE_FIELDS:
            value = record.get(field, "Unknown")
            if value in SENTINELS:
                continue
            if not _DATE_PATTERN.match(value):
                logger.warning(
                    f"[{service}] {record.get('version')}: invalid date format in "
                    f"'{field}' = '{value}'. Resetting to Unknown."
                )
                record[field] = "Unknown"

    # --- 2. Date range plausibility ---
    for record in records:
        for field in DATE_FIELDS:
            value = record.get(field, "Unknown")
            if value in SENTINELS:
                continue
            year = int(value[0:4])
            if year < min_year or year > max_year:
                logger.warning(
                    f"[{service}] {record.get('version')}: implausible year {year} in "
                    f"'{field}' = '{value}' (valid range: {min_year}-{max_year}). "
                    f"Resetting to Unknown."
                )
                record[field] = "Unknown"

    # --- 3. Chronological sanity check ---
    for record in records:
        std = record.get("end_of_standard_support", "Unknown")
        ext = record.get("end_of_extended_support", "Unknown")
        if std not in SENTINELS and ext not in SENTINELS and ext < std:
            logger.warning(
                f"[{service}] {record.get('version')}: end_of_extended_support "
                f"({ext}) < end_of_standard_support ({std}). "
                f"Dates preserved but may indicate upstream doc error."
            )

    # --- 4. Coverage threshold check (opt-in via api_data) ---
    if api_data:
        api_versions_for_service = [r for r in api_data if r["service"] == service]
        if api_versions_for_service:
            versions_with_dates = sum(
                1 for r in records
                if r.get("end_of_standard_support") not in SENTINELS
                or r.get("end_of_extended_support") not in SENTINELS
            )
            total = len(api_versions_for_service)
            coverage = versions_with_dates / total
            if coverage < coverage_threshold:
                logger.warning(
                    f"[{service}]: only {coverage * 100:.0f}% of API-known versions got "
                    f"scraped dates ({versions_with_dates}/{total}). "
                    f"Doc page structure may have changed."
                )

    # --- 5. Cross-source deduplication check ---
    seen: dict[str, dict] = {}
    deduplicated: list[dict] = []
    for record in records:
        version = record.get("version")
        if version in seen:
            existing = seen[version]
            conflict = False
            for field in DATE_FIELDS:
                a, b = existing.get(field, "Unknown"), record.get(field, "Unknown")
                if a not in SENTINELS and b not in SENTINELS and a != b:
                    conflict = True
            if conflict:
                logger.warning(
                    f"[{service}] {version}: conflicting dates from multiple sources. "
                    f"First: std={existing.get('end_of_standard_support')}, "
                    f"ext={existing.get('end_of_extended_support')}. "
                    f"Later: std={record.get('end_of_standard_support')}, "
                    f"ext={record.get('end_of_extended_support')}. Keeping first-seen."
                )
                # Discard later conflicting entry
            else:
                deduplicated.append(record)
        else:
            seen[version] = record
            deduplicated.append(record)

    return deduplicated


def verify_records(records: list[dict], api_data: list[dict] | None = None) -> list[dict]:
    """Verify a list of records that may span multiple services.

    Groups records by their 'service' field and verifies each group
    independently (so deduplication never crosses engines). Original record
    order is preserved.
    """
    by_service: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_service[r["service"]].append(r)

    verified_by_service: dict[str, list[dict]] = {}
    for service, recs in by_service.items():
        try:
            verified_by_service[service] = verify_service(service, recs, api_data)
        except Exception as e:
            logger.warning(f"Verification failed for {service}: {e}. Proceeding with unverified data.")
            verified_by_service[service] = recs

    # Reassemble preserving first-seen service order and within-service order
    result: list[dict] = []
    emitted = set()
    for r in records:
        svc = r["service"]
        if svc not in emitted:
            result.extend(verified_by_service[svc])
            emitted.add(svc)
    return result
