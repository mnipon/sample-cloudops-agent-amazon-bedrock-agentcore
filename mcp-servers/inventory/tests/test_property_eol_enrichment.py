# Feature: inventory-mcp-server, Property 4: EOL Enrichment Correctness
# Validates: Requirements 4.5, 5.8
"""
Property 4: EOL Enrichment Correctness

For any cluster with a version string, if that version exists as a key in the
EOL schedule data for the cluster's service, the tool response SHALL include
end_of_standard_support and end_of_extended_support values matching the DynamoDB
record. If the version does NOT exist in the EOL data, both fields SHALL be
the string "Unknown".
"""

from hypothesis import given, settings
from hypothesis import strategies as st
from unittest.mock import patch, MagicMock


# Strategy: generate EKS-like version strings
version_strategy = st.from_regex(r"1\.\d{1,2}", fullmatch=True)

# Strategy: generate ISO-like date strings for EOL dates
date_strategy = st.from_regex(r"202[3-9]-\d{2}-\d{2}", fullmatch=True)


@st.composite
def eol_enrichment_scenario(draw):
    """Generate a scenario with cluster versions and a subset that have EOL data."""
    # Generate between 1 and 5 distinct cluster versions
    all_versions = draw(
        st.lists(version_strategy, min_size=1, max_size=5, unique=True)
    )

    # Pick a subset of versions that will have EOL data (can be empty)
    versions_with_eol = draw(
        st.lists(
            st.sampled_from(all_versions),
            min_size=0,
            max_size=len(all_versions),
            unique=True,
        )
    )

    # Generate EOL data for each version in the subset
    eol_data = {}
    for version in versions_with_eol:
        standard_date = draw(date_strategy)
        extended_date = draw(date_strategy)
        eol_data[version] = {
            "end_of_standard_support": standard_date,
            "end_of_extended_support": extended_date,
        }

    return all_versions, eol_data


@settings(max_examples=100, deadline=None)
@given(scenario=eol_enrichment_scenario())
def test_eol_enrichment_correctness(scenario):
    """
    **Validates: Requirements 4.5, 5.8**

    For any cluster with a version string:
    - If the version exists in EOL data, end_of_standard_support and
      end_of_extended_support must match the EOL record.
    - If the version does NOT exist in EOL data, both fields must be "Unknown".
    """
    all_versions, eol_data = scenario

    # Build mock EKS client that returns clusters with the generated versions
    mock_eks_client = MagicMock()
    mock_eks_client.list_clusters.return_value = {
        "clusters": [f"cluster-{i}" for i in range(len(all_versions))]
    }

    def describe_cluster(name):
        idx = int(name.split("-")[1])
        return {
            "cluster": {
                "name": name,
                "version": all_versions[idx],
                "status": "ACTIVE",
                "arn": f"arn:aws:eks:us-east-1:123456789012:cluster/{name}",
                "createdAt": "2024-01-01T00:00:00Z",
                "platformVersion": "eks.1",
            }
        }

    mock_eks_client.describe_cluster.side_effect = describe_cluster

    with patch(
        "inventory_mcp_server.tools.eks.get_all_regions",
        return_value=["us-east-1"],
    ), patch(
        "inventory_mcp_server.tools.eks.get_client",
        return_value=mock_eks_client,
    ), patch(
        "inventory_mcp_server.tools.eks.get_eol_schedule",
        return_value=eol_data,
    ):
        # Import and call the function under test
        from mcp.server.fastmcp import FastMCP

        mcp = FastMCP("test")

        # We need to register and call the tool
        from inventory_mcp_server.tools.eks import register_eks_tools

        register_eks_tools(mcp)

        # Call list_eks_clusters directly via the registered tool
        # Access the inner function through the mcp tool registry
        result = mcp._tool_manager._tools["list_eks_clusters"].fn()

    # Verify enrichment correctness for each cluster
    assert len(result) == len(all_versions)

    for cluster_result in result:
        version = cluster_result["version"]

        if version in eol_data:
            # Version has EOL data: fields must match
            assert cluster_result["end_of_standard_support"] == eol_data[version]["end_of_standard_support"], (
                f"Version {version} should have end_of_standard_support="
                f"'{eol_data[version]['end_of_standard_support']}' but got "
                f"'{cluster_result['end_of_standard_support']}'"
            )
            assert cluster_result["end_of_extended_support"] == eol_data[version]["end_of_extended_support"], (
                f"Version {version} should have end_of_extended_support="
                f"'{eol_data[version]['end_of_extended_support']}' but got "
                f"'{cluster_result['end_of_extended_support']}'"
            )
        else:
            # Version NOT in EOL data: both fields must be "Unknown"
            assert cluster_result["end_of_standard_support"] == "Unknown", (
                f"Version {version} has no EOL data, end_of_standard_support "
                f"should be 'Unknown' but got '{cluster_result['end_of_standard_support']}'"
            )
            assert cluster_result["end_of_extended_support"] == "Unknown", (
                f"Version {version} has no EOL data, end_of_extended_support "
                f"should be 'Unknown' but got '{cluster_result['end_of_extended_support']}'"
            )
