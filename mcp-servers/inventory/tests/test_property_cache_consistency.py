# Feature: inventory-mcp-server, Property 2: Cache Consistency Within TTL
"""
Property-based test: For any service name queried via get_eol_schedule(service),
calling the function a second time within the cache TTL period SHALL return an
identical result without issuing a new DynamoDB query.

**Validates: Requirements 4.5**
"""
import os
from unittest.mock import MagicMock, patch

from hypothesis import given, settings
from hypothesis import strategies as st

# Set required environment variables before importing the module under test
os.environ.setdefault("EOL_TABLE_NAME", "test-eol-table")
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("EOL_CACHE_TTL", "300")

from inventory_mcp_server import eol_reader
from inventory_mcp_server.eol_reader import get_eol_schedule


@given(service_name=st.text(min_size=1, max_size=50))
@settings(max_examples=100)
def test_cache_consistency_within_ttl(service_name: str):
    """
    For any non-empty service name, calling get_eol_schedule twice within the
    TTL should return identical results and only query DynamoDB once.

    **Validates: Requirements 4.5**
    """
    # Clear cache before each test iteration
    eol_reader._cache.clear()

    # Create a mock table with a query method that returns sample data
    mock_table = MagicMock()
    mock_table.query.return_value = {
        "Items": [
            {
                "service": service_name,
                "version": "1.0",
                "end_of_standard_support": "2025-12-31",
                "end_of_extended_support": "2026-06-30",
                "status": "current",
                "release_date": "2023-01-01",
            }
        ]
    }

    # Mock both _get_table and boto3.dynamodb.conditions.Key used within get_eol_schedule
    mock_key = MagicMock()
    mock_key.return_value.eq.return_value = "mocked-key-condition"

    with patch.object(eol_reader, "_get_table", return_value=mock_table), \
         patch("boto3.dynamodb.conditions.Key", mock_key):
        # First call — should hit DynamoDB
        result1 = get_eol_schedule(service_name)

        # Second call — should return cached data without a new query
        result2 = get_eol_schedule(service_name)

    # The mock's query method should have been called exactly once
    assert mock_table.query.call_count == 1, (
        f"Expected exactly 1 DynamoDB query call, got {mock_table.query.call_count}. "
        f"Cache should serve the second request for service '{service_name}'."
    )

    # Both results must be identical
    assert result1 == result2, (
        f"Results differ for service '{service_name}': {result1} != {result2}"
    )
