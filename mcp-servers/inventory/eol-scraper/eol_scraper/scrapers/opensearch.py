"""Fetch OpenSearch/Elasticsearch versions from API + enrich with EOL dates from docs.

The EOL dates live on the "what-is.html" page in two tables (one for Elasticsearch,
one for OpenSearch). The version column uses ranges like "OpenSearch versions 1.0
through 1.2" or "2.11 and higher versions", so we expand/match ranges against the
concrete versions returned by the ListVersions API.
"""
import re
import logging
import requests
import boto3
from bs4 import BeautifulSoup
from datetime import datetime

from .. import verification

logger = logging.getLogger(__name__)

DOC_URL = "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html"


def _extract_date(text: str) -> str:
    text = text.strip().rstrip("*")
    if not text or "not announced" in text.lower() or "n/a" in text.lower():
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


def _vtuple(s: str) -> tuple:
    """Convert a version string like '7.10' into a comparable tuple (7, 10)."""
    parts = s.split(".")
    return tuple(int(p) for p in parts)


def _version_matches(version: str, text: str) -> bool:
    """Check whether a concrete version is covered by a docs version-range cell.

    Handles forms like:
      - "Elasticsearch versions 5.1 to 5.5"     → range [5.1, 5.5]
      - "OpenSearch versions 1.0 through 1.2"    → range [1.0, 1.2]
      - "Elasticsearch versions 1.5 and 2.3"     → discrete {1.5, 2.3}
      - "Elasticsearch versions 5.6"             → discrete {5.6}
      - "OpenSearch versions 2.11 and higher versions" → >= 2.11
    """
    tokens = re.findall(r"\d+\.\d+", text)
    if not tokens:
        return False
    v = _vtuple(version)
    toks = [_vtuple(t) for t in tokens]
    text_l = text.lower()

    if re.search(r"\bto\b", text_l) or "through" in text_l:
        return toks[0] <= v <= toks[-1]
    if "higher" in text_l or "later" in text_l:
        return v >= toks[0]
    # Discrete list ("and", commas) or a single version
    return v in toks


def _engine_from_text(text: str) -> str:
    return "elasticsearch" if "elasticsearch" in text.lower() else "opensearch"


def _scrape_eol_tables() -> list[dict]:
    """Scrape the EOL tables. Returns list of {engine, text, std, ext}."""
    rows = []
    try:
        resp = requests.get(DOC_URL, timeout=30)
        soup = BeautifulSoup(resp.text, "html.parser")
        for table in soup.find_all("table"):
            headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
            idx_std = next((i for i, h in enumerate(headers) if "end of standard support" in h), -1)
            idx_ext = next((i for i, h in enumerate(headers) if "end of extended support" in h), -1)
            if idx_std == -1:
                continue
            for tr in table.find_all("tr")[1:]:
                cells = [td.get_text(strip=True) for td in tr.find_all("td")]
                if len(cells) <= idx_std:
                    continue
                version_text = cells[0]
                rows.append({
                    "engine": _engine_from_text(version_text),
                    "text": version_text,
                    "end_of_standard_support": _extract_date(cells[idx_std]),
                    "end_of_extended_support": _extract_date(cells[idx_ext]) if idx_ext >= 0 and idx_ext < len(cells) else "Unknown",
                })
    except Exception as e:
        logger.warning(f"Failed to scrape OpenSearch docs: {e}")
    return rows


def fetch(region: str) -> list[dict]:
    """Get all OpenSearch versions from ListVersions API and enrich with scraped EOL dates."""
    doc_rows = _scrape_eol_tables()

    client = boto3.client("opensearch", region_name=region)
    resp = client.list_versions()
    results = []
    for full_ver in resp.get("Versions", []):
        # Format: "OpenSearch_2.17" or "Elasticsearch_7.10"
        short_ver = full_ver.split("_")[-1] if "_" in full_ver else full_ver
        engine = "opensearch" if "OpenSearch" in full_ver else "elasticsearch"

        std = "Unknown"
        ext = "Unknown"
        # Match against doc rows of the same engine
        for row in doc_rows:
            if row["engine"] != engine:
                continue
            try:
                if _version_matches(short_ver, row["text"]):
                    std = row["end_of_standard_support"]
                    ext = row["end_of_extended_support"]
                    break
            except Exception:
                continue

        results.append({
            "service": engine,
            "version": short_ver,
            "end_of_standard_support": std,
            "end_of_extended_support": ext,
            "status": "available",
            "source": "api+docs:opensearch",
        })
    return verification.verify_records(results)
