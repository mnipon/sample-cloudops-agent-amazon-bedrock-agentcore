# Bugfix Requirements Document

## Introduction

The RDS EOL scraper (`eol_scraper/scrapers/rds.py`) produces incomplete end-of-life data because it only has a single documentation URL configured (RDS MySQL). This causes almost all RDS and Aurora records in the DynamoDB `aws-eol-schedules` table to show "Unknown" for both `end_of_standard_support` and `end_of_extended_support` dates. The fix requires adding documentation URLs for all RDS/Aurora engine families (PostgreSQL, Aurora MySQL, Aurora PostgreSQL, MariaDB) and ensuring the scraping logic correctly parses the EOL tables on each page.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the scraper runs for RDS PostgreSQL versions THEN the system produces "Unknown" for end_of_standard_support and end_of_extended_support because no PostgreSQL documentation URL is configured in DOC_URLS

1.2 WHEN the scraper runs for Aurora MySQL versions THEN the system produces "Unknown" for end_of_standard_support and end_of_extended_support because no Aurora MySQL documentation URL is configured in DOC_URLS

1.3 WHEN the scraper runs for Aurora PostgreSQL versions THEN the system produces "Unknown" for end_of_standard_support and end_of_extended_support because no Aurora PostgreSQL documentation URL is configured in DOC_URLS

1.4 WHEN the scraper runs for RDS MariaDB versions THEN the system produces "Unknown" for end_of_standard_support and end_of_extended_support because no MariaDB documentation URL is configured in DOC_URLS

1.5 WHEN the scraper runs for RDS MySQL versions THEN the system may produce "Unknown" for some versions because the single configured URL may not match the current table structure on the documentation page or may miss supplemental release calendar pages

### Expected Behavior (Correct)

2.1 WHEN the scraper runs for RDS PostgreSQL versions THEN the system SHALL scrape the PostgreSQL release calendar documentation pages and populate end_of_standard_support and end_of_extended_support dates for each major version

2.2 WHEN the scraper runs for Aurora MySQL versions THEN the system SHALL scrape the Aurora MySQL release calendar documentation page and populate end_of_standard_support and end_of_extended_support dates for each major version

2.3 WHEN the scraper runs for Aurora PostgreSQL versions THEN the system SHALL scrape the Aurora PostgreSQL release calendar documentation page and populate end_of_standard_support and end_of_extended_support dates for each major version

2.4 WHEN the scraper runs for RDS MariaDB versions THEN the system SHALL scrape the MariaDB version management documentation page and populate end_of_standard_support and end_of_extended_support dates for each major version

2.5 WHEN the scraper runs for RDS MySQL versions THEN the system SHALL scrape all relevant MySQL documentation pages (version management and any supplemental calendar pages) and populate end_of_standard_support and end_of_extended_support dates for each major version

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the scraper runs for RDS/Aurora engines THEN the system SHALL CONTINUE TO fetch version lists from the RDS DescribeDBEngineVersions API for all engines (mysql, postgres, aurora-mysql, aurora-postgresql)

3.2 WHEN a scraped EOL date matches a version returned by the API THEN the system SHALL CONTINUE TO merge the scraped date onto the API version record

3.3 WHEN no scraped date is found for a version THEN the system SHALL CONTINUE TO include the version in results with "Unknown" dates rather than omitting it

3.4 WHEN scraped items exist that are not found in the API THEN the system SHALL CONTINUE TO include those items in the output results

3.5 WHEN the scraper output is written to DynamoDB THEN the system SHALL CONTINUE TO write records with the same schema (service, version, end_of_standard_support, end_of_extended_support, status, source)

### Runtime Verification Loop Behavior

4.1 WHEN scraped date values do not match the YYYY-MM-DD format AND the value is not "Unknown" THEN the system SHALL log a warning and reset the invalid date field to "Unknown" before writing to DynamoDB

4.2 WHEN a scraped record has both end_of_standard_support and end_of_extended_support as valid dates AND end_of_extended_support < end_of_standard_support THEN the system SHALL log a warning indicating chronologically inverted dates but SHALL still include both date values in the output

4.3 WHEN fewer than N% (configurable, default 50%) of API-known versions for a service receive non-"Unknown" dates from scraping THEN the system SHALL log a warning indicating potential documentation page structure changes but SHALL still proceed with the available data

4.4 WHEN a scraped date has a year outside the plausible range (configurable, default 2020 to 2035) THEN the system SHALL log a warning and reset the implausible date field to "Unknown" before writing to DynamoDB

4.5 WHEN multiple source URLs for the same service produce conflicting dates for the same version THEN the system SHALL log a warning and retain the date from the first URL processed (earlier URL takes priority)

4.6 WHEN all verification checks pass without warnings THEN the system SHALL proceed to the merge phase without modifying any scraped data

4.7 WHEN any verification check produces warnings THEN the system SHALL NOT halt or raise exceptions but SHALL continue processing remaining services and writing results to DynamoDB
