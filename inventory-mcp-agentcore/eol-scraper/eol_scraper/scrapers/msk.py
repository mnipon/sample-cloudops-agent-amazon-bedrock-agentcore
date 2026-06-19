"""Fetch MSK Kafka versions from API + enrich with end-of-support dates from AWS docs.

MSK only has a single "End of support date" column (no extended support tier),
so end_of_extended_support is always "N/A".
"""
import re
import logging
import requests
import boto3
from bs4 import BeautifulSoup
from datetime import datetime

from .. import verification

logger = logging.getLogger(__name__)

DOC_URL = "https://docs.aws.amazon.com/msk/latest/developerguide/supported-kafka-versions.html"


def _extract_date(text: str) -> str:
    text = text.strip().rstrip("*")
    if not text or text == "--":
        return "Unknown"
    m = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if m:
        return m.group(0)
    for fmt in ["%B %d, %Y", "%b %d, %Y", "%d %B %Y"]:
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    for fmt in ["%B %Y", "%b %Y"]:
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-01")
        except ValueError:
            continue
    return text


def _scrape_eol_dates() -> dict:
    """Scrape the supported Kafka versions table. Returns {version: end_of_standard_support}."""
    scraped = {}
    try:
        resp = requests.get(DOC_URL, timeout=30)
        soup = BeautifulSoup(resp.text, "html.parser")
        for table in soup.find_all("table"):
            headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
            # Table with "apache kafka version" and "end of support date"
            idx_ver = next((i for i, h in enumerate(headers) if "version" in h), -1)
            idx_eos = next((i for i, h in enumerate(headers) if "end of support" in h), -1)
            if idx_ver == -1 or idx_eos == -1:
                continue
            for tr in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in tr.find_all("td")]
                if len(cells) <= max(idx_ver, idx_eos):
                    continue
                # Version is an exact Kafka version like "2.8.1", "3.6.0"
                m = re.search(r"(\d+\.\d+(?:\.\d+)?)", cells[idx_ver])
                if not m:
                    continue
                scraped[m.group(1)] = _extract_date(cells[idx_eos])
    except Exception as e:
        logger.warning(f"Failed to scrape MSK docs: {e}")
    return scraped


def fetch(region: str) -> list[dict]:
    """Get all MSK Kafka versions from API and enrich with scraped end-of-support dates."""
    eol_dates = _scrape_eol_dates()

    client = boto3.client("kafka", region_name=region)
    resp = client.get_compatible_kafka_versions()
    seen = set()
    results = []
    for cv in resp.get("CompatibleKafkaVersions", []):
        ver = cv["SourceVersion"]
        # Skip variants (kraft, tiered, link)
        if ver in seen or ".kraft" in ver or ".link" in ver or ".tiered" in ver:
            continue
        seen.add(ver)
        has_targets = len(cv.get("TargetVersions", [])) > 0
        results.append({
            "service": "msk",
            "version": ver,
            "end_of_standard_support": eol_dates.get(ver, "Unknown"),
            "end_of_extended_support": "N/A",
            "status": "available" if has_targets else "latest",
            "source": "api+docs:msk",
        })

    # Add any scraped versions not returned by the API (older/deprecated versions)
    for ver, eos in eol_dates.items():
        if ver not in seen:
            results.append({
                "service": "msk",
                "version": ver,
                "end_of_standard_support": eos,
                "end_of_extended_support": "N/A",
                "status": "deprecated",
                "source": "docs:msk",
            })
            seen.add(ver)

    return verification.verify_records(results)
