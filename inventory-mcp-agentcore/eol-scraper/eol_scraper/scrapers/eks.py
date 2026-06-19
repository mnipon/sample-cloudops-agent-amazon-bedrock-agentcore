"""Fetch EKS EOL dates from the DescribeClusterVersions API."""
import boto3


def fetch(region: str) -> list[dict]:
    client = boto3.client("eks", region_name=region)
    resp = client.describe_cluster_versions()
    return [{
        "service": "eks",
        "version": v["clusterVersion"],
        "release_date": str(v.get("releaseDate", "")).split("T")[0].split(" ")[0],
        "end_of_standard_support": str(v.get("endOfStandardSupportDate", "")).split("T")[0].split(" ")[0],
        "end_of_extended_support": str(v.get("endOfExtendedSupportDate", "")).split("T")[0].split(" ")[0],
        "status": v.get("status", ""),
        "source": "api:eks:DescribeClusterVersions",
    } for v in resp.get("clusterVersions", [])]
