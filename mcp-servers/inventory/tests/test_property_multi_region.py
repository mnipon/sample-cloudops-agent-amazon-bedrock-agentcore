# Feature: inventory-mcp-server, Property 3: Multi-Region Cluster Aggregation Completeness
"""
Property-based test verifying that list_eks_clusters() aggregates clusters from
all enabled regions and correctly assigns the region field to each result.

**Validates: Requirements 4.4**
"""

from unittest.mock import patch, MagicMock
from hypothesis import given, settings
from hypothesis import strategies as st


# Strategy: generate a dict of region -> list of cluster names
# Regions are non-empty strings, cluster names are non-empty strings
region_cluster_strategy = st.dictionaries(
    keys=st.text(
        alphabet=st.characters(whitelist_categories=("Ll", "Nd"), whitelist_characters="-"),
        min_size=1,
        max_size=20,
    ),
    values=st.lists(
        st.text(
            alphabet=st.characters(whitelist_categories=("Ll", "Nd"), whitelist_characters="-"),
            min_size=1,
            max_size=20,
        ),
        min_size=0,
        max_size=5,
    ),
    min_size=0,
    max_size=5,
)


def _make_mock_client(clusters_for_region: list[str]):
    """Create a mock EKS client that returns given clusters for a region."""
    mock_client = MagicMock()
    mock_client.list_clusters.return_value = {"clusters": clusters_for_region}

    def describe_cluster(name: str = None, **kwargs):
        return {
            "cluster": {
                "name": name,
                "version": "1.29",
                "status": "ACTIVE",
                "arn": f"arn:aws:eks:region:123456789012:cluster/{name}",
                "createdAt": "2024-01-01T00:00:00Z",
                "platformVersion": "eks.1",
            }
        }

    mock_client.describe_cluster.side_effect = describe_cluster
    return mock_client


@settings(max_examples=100, deadline=None)
@given(region_clusters=region_cluster_strategy)
def test_multi_region_aggregation_completeness(region_clusters: dict[str, list[str]]):
    """
    For any set of enabled regions where each region contains zero or more clusters,
    calling list_eks_clusters() without specifying a region SHALL return results from
    every enabled region that has clusters, and each result's region field SHALL match
    the region from which the cluster was retrieved.

    **Validates: Requirements 4.4**
    """
    regions = list(region_clusters.keys())

    # Build a mapping from region to its mock client
    def mock_get_client(service: str, region: str):
        clusters = region_clusters.get(region, [])
        return _make_mock_client(clusters)

    with patch(
        "inventory_mcp_server.tools.eks.get_all_regions", return_value=regions
    ), patch(
        "inventory_mcp_server.tools.eks.get_client", side_effect=mock_get_client
    ), patch(
        "inventory_mcp_server.tools.eks.get_eol_schedule", return_value={}
    ):
        # Import and call the inner tool function
        from mcp.server.fastmcp import FastMCP

        mcp = FastMCP("test")

        # Re-register the tools to get a reference to the inner function
        from inventory_mcp_server.tools.eks import register_eks_tools

        register_eks_tools(mcp)

        # Call list_eks_clusters via the registered tool
        # Access the tool function directly from the mcp instance
        tool_fn = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "list_eks_clusters":
                tool_fn = tool.fn
                break

        assert tool_fn is not None, "list_eks_clusters tool not found"
        results = tool_fn()

    # Verify: every region that has clusters appears in the results
    regions_with_clusters = {r for r, clusters in region_clusters.items() if clusters}
    regions_in_results = {item["region"] for item in results}

    assert regions_with_clusters == regions_in_results, (
        f"Expected regions {regions_with_clusters} but got {regions_in_results}"
    )

    # Verify: each result's region field matches the region from which the cluster was mocked
    for item in results:
        region = item["region"]
        cluster_name = item["name"]
        assert cluster_name in region_clusters[region], (
            f"Cluster '{cluster_name}' reported in region '{region}' but was not mocked there"
        )

    # Verify: total result count matches total clusters across all regions
    expected_count = sum(len(clusters) for clusters in region_clusters.values())
    assert len(results) == expected_count, (
        f"Expected {expected_count} results but got {len(results)}"
    )
