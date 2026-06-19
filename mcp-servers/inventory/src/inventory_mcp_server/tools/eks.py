from mcp.server.fastmcp import FastMCP
from ..aws_client import get_client, get_default_region, get_all_regions
from ..eol_reader import get_eol_schedule


def register_eks_tools(mcp: FastMCP):
    @mcp.tool()
    def list_eks_clusters(region: str | None = None) -> list[dict]:
        """List all EKS clusters with version, status, ARN, and end-of-support dates. Scans all regions if region not specified."""
        regions = [region] if region else get_all_regions()
        eol_data = get_eol_schedule("eks")
        results = []
        for r in regions:
            try:
                client = get_client("eks", r)
                clusters = client.list_clusters()["clusters"]
                for name in clusters:
                    info = client.describe_cluster(name=name)["cluster"]
                    version = info.get("version", "")
                    eol = eol_data.get(version, {})
                    results.append({
                        "name": info["name"],
                        "version": version,
                        "status": info.get("status"),
                        "arn": info.get("arn"),
                        "region": r,
                        "created_at": str(info.get("createdAt", "")),
                        "platform_version": info.get("platformVersion"),
                        "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
                        "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
                    })
            except Exception:
                continue
        return results

    @mcp.tool()
    def get_eks_cluster_detail(cluster_name: str, region: str | None = None) -> dict:
        """Get detailed information about a specific EKS cluster including addons and nodegroups."""
        region = region or get_default_region()
        client = get_client("eks", region)
        eol_data = get_eol_schedule("eks")
        info = client.describe_cluster(name=cluster_name)["cluster"]
        version = info.get("version", "")
        eol = eol_data.get(version, {})
        addons = client.list_addons(clusterName=cluster_name).get("addons", [])
        nodegroups = client.list_nodegroups(clusterName=cluster_name).get("nodegroups", [])
        return {
            "name": info["name"],
            "version": version,
            "status": info.get("status"),
            "arn": info.get("arn"),
            "region": region,
            "created_at": str(info.get("createdAt", "")),
            "platform_version": info.get("platformVersion"),
            "endpoint": info.get("endpoint"),
            "role_arn": info.get("roleArn"),
            "kubernetes_network_config": info.get("kubernetesNetworkConfig"),
            "addons": addons,
            "nodegroups": nodegroups,
            "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
            "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
        }

    @mcp.tool()
    def get_eks_supported_versions() -> list[dict]:
        """Get all known EKS Kubernetes versions with their end-of-support schedules from DynamoDB."""
        eol_data = get_eol_schedule("eks")
        return [{"version": v, **dates} for v, dates in sorted(eol_data.items())]
