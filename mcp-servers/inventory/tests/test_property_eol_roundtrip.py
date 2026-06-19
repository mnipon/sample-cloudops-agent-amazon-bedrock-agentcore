# Feature: inventory-mcp-server, Property 1: EOL Data Round-Trip Integrity
# **Validates: Requirements 3.3, 5.8**
"""
Property-based test for EOL data round-trip integrity.

Generates random service/version/date combos, writes to mocked DynamoDB via
write_to_dynamodb, reads back via get_eol_schedule(service), and verifies
that the returned values match what was written.
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
from inventory_mcp_server.eol_reader import get_eol_schedule  # noqa: E402
import inventory_mcp_server.eol_reader as eol_reader  # noqa: E402


# --- Strategies ---

# Non-empty strings for service and version (printable, no null bytes)
service_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P"), min_codepoint=32, max_codepoint=126),
    min_size=1,
    max_size=50,
).filter(lambda s: s.strip() != "")

version_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P"), min_codepoint=32, max_codepoint=126),
    min_size=1,
    max_size=30,
).filter(lambda s: s.strip() != "")

# Date strategy: either an ISO date string or "Unknown"
iso_date_strategy = st.dates().map(lambda d: d.isoformat())
date_or_unknown_strategy = st.one_of(iso_date_strategy, st.just("Unknown"))


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
class TestEolRoundTripIntegrity:
    """Property test class that maintains a single moto mock context for all examples."""

    @settings(max_examples=100, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        service=service_strategy,
        version=version_strategy,
        end_of_standard=date_or_unknown_strategy,
        end_of_extended=date_or_unknown_strategy,
    )
    def test_eol_roundtrip_integrity(self, service, version, end_of_standard, end_of_extended):
        """Writing an EOL record and reading it back yields matching values."""
        # Clear the eol_reader cache between iterations
        eol_reader._cache.clear()

        # Ensure table exists (idempotent within the mock context)
        dynamodb = boto3.client("dynamodb", region_name="us-east-1")
        try:
            dynamodb.describe_table(TableName="aws-eol-schedules")
        except dynamodb.exceptions.ResourceNotFoundException:
            _create_eol_table()

        # Write the record via the scraper's write function
        items = [
            {
                "service": service,
                "version": version,
                "end_of_standard_support": end_of_standard,
                "end_of_extended_support": end_of_extended,
            }
        ]
        write_to_dynamodb(items)

        # Read back via the eol_reader
        result = get_eol_schedule(service)

        # Verify the version exists in the result and values match
        assert version in result, f"Version '{version}' not found in result for service '{service}'"
        assert result[version]["end_of_standard_support"] == end_of_standard
        assert result[version]["end_of_extended_support"] == end_of_extended
