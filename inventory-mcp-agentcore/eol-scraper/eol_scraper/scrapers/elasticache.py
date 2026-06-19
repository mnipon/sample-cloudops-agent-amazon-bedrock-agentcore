"""Scrape ElastiCache EOL dates from AWS docs + supplement with API data.

The ElastiCache major version EOL table has multiple "Start of Extended Support"
columns (Y1/Y2/Y3 pricing) plus a final "End of Extended Support and version EOL"
column. We must pick the END column, not the START columns.
"""
import re
import logging
import requests
import boto3
from bs4 import BeautifulSoup
from datetime import datetime

from .. import verification

logger = logging.getLogger(__name__)

URL = "https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html"


def _extract_date(text: str) -> str:
    text = text.strip().rstrip("*")
    if not text:
        return "Unknown"
    # M/D/YYYY format (ElastiCache uses this)
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", text)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    m = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if m:
        return m.group(0)
    for fmt in ["%B %d, %Y", "%b %d, %Y"]:
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


def _engine_from_text(text: str) -> str:
    """Determine the engine from the version cell text."""
    t = text.lower()
    if "valkey" in t:
        return "valkey"
    if "memcached" in t:
        return "memcached"
    # "Redis OSS v4" or just "Redis"
    return "redis"


def _scrape_eol_table() -> dict:
    """Scrape the major version EOL table.

    Returns {(engine, major_version): {end_of_standard_support, end_of_extended_support}}.
    """
    scraped = {}
    try:
        resp = requests.get(URL, timeout=30)
        soup = BeautifulSoup(resp.text, "html.parser")
        for table in soup.find_all("table"):
            headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
            # Strict matching: standard support and the END of extended support
            # (NOT "start of extended support ... pricing" columns)
            idx_std = next((i for i, h in enumerate(headers) if "end of standard support" in h), -1)
            idx_ext = next((i for i, h in enumerate(headers) if "end of extended support" in h), -1)
            if idx_std == -1:
                continue
            for tr in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in tr.find_all("td")]
                if len(cells) <= idx_std:
                    continue
                # First cell looks like "Redis OSS v4", "Valkey 7", etc.
                m = re.search(r"v?(\d+)", cells[0])
                if not m:
                    continue
                engine = _engine_from_text(cells[0])
                major = m.group(1)
                scraped[(engine, major)] = {
                    "end_of_standard_support": _extract_date(cells[idx_std]),
                    "end_of_extended_support": _extract_date(cells[idx_ext]) if idx_ext >= 0 and idx_ext < len(cells) else "Unknown",
                }
    except Exception as e:
        logger.warning(f"Failed to scrape ElastiCache docs: {e}")
    return scraped


def _fetch_from_api(region: str) -> list[dict]:
    """Get all ElastiCache versions from API."""
    client = boto3.client("elasticache", region_name=region)
    results = []
    for engine in ["redis", "valkey", "memcached"]:
        try:
            resp = client.describe_cache_engine_versions(Engine=engine)
            seen = set()
            for v in resp.get("CacheEngineVersions", []):
                major_minor = ".".join(v["EngineVersion"].split(".")[:2])
                if major_minor in seen:
                    continue
                seen.add(major_minor)
                results.append({
                    "service": f"elasticache-{engine}",
                    "engine": engine,
                    "version": major_minor,
                    "status": "available",
                })
        except Exception:
            continue
    return results


def fetch(region: str) -> list[dict]:
    """Combine API versions with scraped EOL dates."""
    api_data = _fetch_from_api(region)
    scraped = _scrape_eol_table()

    results = []
    for item in api_data:
        engine = item["engine"]
        major = item["version"].split(".")[0]
        eol = scraped.get((engine, major), {})
        results.append({
            "service": item["service"],
            "version": item["version"],
            "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
            "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
            "status": item["status"],
            "source": "api+docs:elasticache",
        })
    return verification.verify_records(results)
