"""Bug condition exploration test for RDS EOL scraper multi-engine support.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

This test is EXPECTED TO FAIL on unfixed code because:
- DOC_URLS only has 'rds-mysql' configured
- No URLs exist for postgresql, aurora-mysql, aurora-postgresql, or mariadb
- Therefore these services will all return "Unknown" dates

The test encodes the expected behavior: after the fix, each non-MySQL engine
should have at least one record with scraped (non-"Unknown") EOL dates.
"""

import pytest
from unittest.mock import patch, MagicMock


# Realistic HTML table content for each engine's documentation page
POSTGRESQL_HTML = """
<html><body>
<table>
<tr><th>Major version</th><th>Community release date</th><th>RDS release date</th><th>End of standard support</th><th>End of extended support</th></tr>
<tr><td>PostgreSQL 16</td><td>September 14, 2023</td><td>October 30, 2023</td><td>2028-10-14</td><td>2029-10-14</td></tr>
<tr><td>PostgreSQL 15</td><td>October 13, 2022</td><td>February 27, 2023</td><td>2027-11-11</td><td>2028-11-11</td></tr>
<tr><td>PostgreSQL 14</td><td>September 30, 2021</td><td>January 26, 2022</td><td>2026-02-28</td><td>2027-02-28</td></tr>
<tr><td>PostgreSQL 13</td><td>September 24, 2020</td><td>March 16, 2021</td><td>2025-06-30</td><td>2026-06-30</td></tr>
</table>
</body></html>
"""

AURORA_MYSQL_HTML = """
<html><body>
<table>
<tr><th>Major version</th><th>MySQL compatibility</th><th>Aurora MySQL release date</th><th>End of standard support</th><th>End of extended support</th></tr>
<tr><td>Aurora MySQL 3</td><td>MySQL 8.0</td><td>November 18, 2021</td><td>2027-10-31</td><td>2028-10-31</td></tr>
<tr><td>Aurora MySQL 2</td><td>MySQL 5.7</td><td>February 16, 2018</td><td>2024-10-31</td><td>2025-03-31</td></tr>
</table>
</body></html>
"""

AURORA_POSTGRESQL_HTML = """
<html><body>
<table>
<tr><th>Major version</th><th>PostgreSQL compatibility</th><th>Aurora PostgreSQL release date</th><th>End of standard support</th><th>End of extended support</th></tr>
<tr><td>Aurora PostgreSQL 16</td><td>PostgreSQL 16</td><td>January 11, 2024</td><td>2028-10-14</td><td>2029-10-14</td></tr>
<tr><td>Aurora PostgreSQL 15</td><td>PostgreSQL 15</td><td>May 8, 2023</td><td>2027-11-11</td><td>2028-11-11</td></tr>
<tr><td>Aurora PostgreSQL 14</td><td>PostgreSQL 14</td><td>April 21, 2022</td><td>2026-02-28</td><td>2027-02-28</td></tr>
</table>
</body></html>
"""

MARIADB_HTML = """
<html><body>
<table>
<tr><th>Major version</th><th>Community release date</th><th>RDS release date</th><th>End of standard support</th><th>End of extended support</th></tr>
<tr><td>MariaDB 10.11</td><td>February 16, 2023</td><td>August 2, 2023</td><td>2028-02-16</td><td>2029-02-16</td></tr>
<tr><td>MariaDB 10.6</td><td>July 6, 2021</td><td>February 3, 2022</td><td>2026-07-06</td><td>2027-07-06</td></tr>
<tr><td>MariaDB 10.5</td><td>June 24, 2020</td><td>January 21, 2021</td><td>2025-06-24</td><td>2026-06-24</td></tr>
</table>
</body></html>
"""

MYSQL_HTML = """
<html><body>
<table>
<tr><th>Major version</th><th>Community release date</th><th>RDS release date</th><th>End of standard support</th><th>End of extended support</th></tr>
<tr><td>MySQL 8.4</td><td>April 30, 2024</td><td>August 14, 2024</td><td>2032-04-30</td><td>2034-04-30</td></tr>
<tr><td>MySQL 8.0</td><td>April 19, 2018</td><td>October 23, 2018</td><td>2026-04-30</td><td>2027-04-30</td></tr>
<tr><td>MySQL 5.7</td><td>October 21, 2015</td><td>November 18, 2015</td><td>2024-02-29</td><td>2025-02-28</td></tr>
</table>
</body></html>
"""


def _mock_describe_db_engine_versions_pages(engine):
    """Return mock paginator pages for each engine type."""
    versions_by_engine = {
        "mysql": [
            {"MajorEngineVersion": "5.7", "Status": "deprecated"},
            {"MajorEngineVersion": "8.0", "Status": "available"},
            {"MajorEngineVersion": "8.4", "Status": "available"},
        ],
        "postgres": [
            {"MajorEngineVersion": "13", "Status": "available"},
            {"MajorEngineVersion": "14", "Status": "available"},
            {"MajorEngineVersion": "15", "Status": "available"},
            {"MajorEngineVersion": "16", "Status": "available"},
        ],
        "aurora-mysql": [
            {"MajorEngineVersion": "2", "Status": "available"},
            {"MajorEngineVersion": "3", "Status": "available"},
        ],
        "aurora-postgresql": [
            {"MajorEngineVersion": "14", "Status": "available"},
            {"MajorEngineVersion": "15", "Status": "available"},
            {"MajorEngineVersion": "16", "Status": "available"},
        ],
        "mariadb": [
            {"MajorEngineVersion": "10.5", "Status": "available"},
            {"MajorEngineVersion": "10.6", "Status": "available"},
            {"MajorEngineVersion": "10.11", "Status": "available"},
        ],
    }
    versions = versions_by_engine.get(engine, [])
    return [{"DBEngineVersions": versions}]


def _mock_requests_get(url, **kwargs):
    """Return realistic HTML content based on the URL."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    if "PostgreSQLReleaseNotes" in url or "postgresql-release-calendar" in url or "postgresql-versions" in url:
        mock_resp.text = POSTGRESQL_HTML
    elif "AuroraMySQLReleaseNotes" in url or "AuroraMySQL.release-calendars" in url:
        mock_resp.text = AURORA_MYSQL_HTML
    elif "AuroraPostgreSQLReleaseNotes" in url or "aurorapostgresql-release-calendar" in url:
        mock_resp.text = AURORA_POSTGRESQL_HTML
    elif "MariaDB" in url:
        mock_resp.text = MARIADB_HTML
    elif "MySQL" in url:
        mock_resp.text = MYSQL_HTML
    else:
        mock_resp.text = "<html><body></body></html>"

    return mock_resp


@pytest.mark.parametrize("service", [
    "rds-postgresql",
    "aurora-mysql",
    "aurora-postgresql",
    "rds-mariadb",
])
def test_multi_engine_eol_dates_not_unknown(service):
    """Property 1: Bug Condition - Multi-Engine EOL Dates Missing.

    **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

    For each service in ['rds-postgresql', 'aurora-mysql', 'aurora-postgresql',
    'rds-mariadb'], calling fetch(region) SHALL return at least one record with
    end_of_standard_support != "Unknown" for that service.

    This test is EXPECTED TO FAIL on unfixed code because DOC_URLS only has
    'rds-mysql' configured, so no other engines get scraped dates.
    """
    # Mock boto3 client for DescribeDBEngineVersions
    mock_paginator = MagicMock()

    def paginate_side_effect(**kwargs):
        engine = kwargs.get("Engine", "")
        return _mock_describe_db_engine_versions_pages(engine)

    mock_paginator.paginate = MagicMock(side_effect=paginate_side_effect)

    mock_client = MagicMock()
    mock_client.get_paginator = MagicMock(return_value=mock_paginator)

    with patch("eol_scraper.scrapers.rds.boto3.client", return_value=mock_client), \
         patch("eol_scraper.scrapers.rds.requests.get", side_effect=_mock_requests_get):

        from eol_scraper.scrapers.rds import fetch
        results = fetch("us-east-1")

    # Filter results for the target service
    service_results = [r for r in results if r["service"] == service]

    # Assert that the service has at least one record
    assert len(service_results) > 0, (
        f"No records found for service '{service}'. "
        f"Expected at least one record from API or scraping."
    )

    # Assert that at least one record has a non-"Unknown" end_of_standard_support date
    records_with_dates = [
        r for r in service_results
        if r["end_of_standard_support"] != "Unknown"
    ]

    assert len(records_with_dates) > 0, (
        f"Bug confirmed: service '{service}' has {len(service_results)} record(s) "
        f"but ALL have end_of_standard_support == 'Unknown'. "
        f"This proves DOC_URLS is missing a configuration for '{service}'."
    )
