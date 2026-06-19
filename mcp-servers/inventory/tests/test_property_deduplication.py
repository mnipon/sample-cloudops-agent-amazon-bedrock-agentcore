# Feature: inventory-mcp-server, Property 5: Scraper Deduplication
# **Validates: Requirements 5.8**
"""
Property-based test for scraper deduplication.

Generates lists of EOL records with duplicate (service, version) pairs,
calls write_to_dynamodb, and verifies that at most one record per unique
(service, version) composite key is written to DynamoDB.
"""

import os
import sys

import boto3
import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st
from moto import mock_aws

# Ensure source packages are importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "eol-scraper"))

# Set environment variables before importing modules that read them at import time
os.environ["EOL_TABLE_NAME"] = "aws-eol-schedules"
os.environ["AWS_REGION"] = "us-east-1"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"

from eol_scraper.main import write_to_dynamodb  # noqa: E402


# --- Strategies ---

# Use a small pool of service/version values to ensure duplicates occur frequently
_SERVICE_POOL = ["eks", "rds", "aurora-mysql", "opensearch", "elasticache", "msk"]
_VERSION_POOL = ["1.29", "1.30", "8.0.36", "7.1", "2.11", "3.6.2", "5.0", "6.2"]

service_strategy = st.sampled_from(_SERVICE_POOL)
version_strategy = st.sampled_from(_VERSION_POOL)

# Date strategy: either an ISO date string or "Unknown"
iso_date_strategy = st.dates().map(lambda d: d.isoformat())
date_or_unknown_strategy = st.one_of(iso_date_strategy, st.just("Unknown"))

# Strategy for a single EOL record item
eol_item_strategy = st.fixed_dictionaries({
    "service": service_strategy,
    "version": version_strategy,
    "end_of_standard_support": date_or_unknown_strategy,
    "end_of_extended_support": date_or_unknown_strategy,
    "status": st.sampled_from(["current", "deprecated", "end-of-life", ""]),
    "release_date": st.one_of(iso_date_strategy, st.just("")),
    "source": st.just("https://docs.aws.amazon.com/test"),
})

# Strategy for a list of items that will frequently contain duplicates
items_list_strategy = st.lists(eol_item_strategy, min_size=1, max_size=50)


def _create_eol_table():
    """Create the DynamoDB table with the correct schema for testing."""
    dynamodb = boto3.client("dynamodb", region_name="us-east-1")
    dynamodb.create_table(
        TableName="aws-eol-schedules",
        KeySchema=[
            {"AttributeName": "service", "KeyType": "HASH"},
            {"AttributeName": "version", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "service", "AttributeType": "S"},
            {"AttributeName": "version", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )


@mock_aws
@settings(max_examples=100, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(items=items_list_strategy)
def test_scraper_deduplication(items):
    """write_to_dynamodb writes at most one record per unique (service, version) key."""
    # Ensure the table exists
    dynamodb = boto3.client("dynamodb", region_name="us-east-1")
    try:
        dynamodb.describe_table(TableName="aws-eol-schedules")
    except dynamodb.exceptions.ResourceNotFoundException:
        _create_eol_table()

    # Clear the table before each example to ensure clean state
    resource = boto3.resource("dynamodb", region_name="us-east-1")
    table = resource.Table("aws-eol-schedules")
    scan_result = table.scan()
    with table.batch_writer() as batch:
        for item in scan_result.get("Items", []):
            batch.delete_item(Key={"service": item["service"], "version": item["version"]})

    # Calculate expected unique keys from the input
    expected_unique_keys = set()
    for item in items:
        expected_unique_keys.add((item["service"], item["version"]))

    # Write items (potentially with duplicates) via the scraper function
    write_to_dynamodb(items)

    # Scan the table and count all records
    scan_result = table.scan()
    written_records = scan_result.get("Items", [])

    # Verify: number of records equals the number of unique (service, version) keys
    assert len(written_records) == len(expected_unique_keys), (
        f"Expected {len(expected_unique_keys)} unique records, "
        f"but found {len(written_records)} in DynamoDB. "
        f"Input had {len(items)} items."
    )

    # Verify: each unique key has exactly one record in the table
    written_keys = set()
    for record in written_records:
        key = (record["service"], record["version"])
        assert key not in written_keys, (
            f"Duplicate key {key} found in DynamoDB table"
        )
        written_keys.add(key)

    # Verify: all expected keys are present
    assert written_keys == expected_unique_keys, (
        f"Written keys {written_keys} do not match expected {expected_unique_keys}"
    )
