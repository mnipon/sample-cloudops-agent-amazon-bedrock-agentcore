from mcp.server.fastmcp import FastMCP
from ..aws_client import get_client, get_default_region, get_all_regions
from ..eol_reader import get_eol_schedule


def register_msk_tools(mcp: FastMCP):
    @mcp.tool()
    def list_msk_clusters(region: str | None = None) -> list[dict]:
        """List all MSK (Kafka) clusters with version, status, ARN, and end-of-support dates. Scans all regions if region not specified."""
        regions = [region] if region else get_all_regions()
        eol_data = get_eol_schedule("msk")
        results = []
        for r in regions:
            try:
                client = get_client("kafka", r)
                paginator = client.get_paginator("list_clusters_v2")
                for page in paginator.paginate():
                    for c in page.get("ClusterInfoList", []):
                        provisioned = c.get("Provisioned", {})
                        kafka_version = provisioned.get("CurrentBrokerSoftwareInfo", {}).get("KafkaVersion") or "serverless"
                        eol = eol_data.get(kafka_version, {})
                        results.append({
                            "cluster_name": c.get("ClusterName"),
                            "cluster_type": c.get("ClusterType"),
                            "kafka_version": kafka_version,
                            "state": c.get("State"),
                            "arn": c.get("ClusterArn"),
                            "region": r,
                            "created_at": str(c.get("CreationTime", "")),
                            "broker_node_count": provisioned.get("NumberOfBrokerNodes"),
                            "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
                            "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
                        })
            except Exception:
                continue
        return results

    @mcp.tool()
    def get_msk_cluster_detail(cluster_arn: str, region: str | None = None) -> dict:
        """Get detailed information about a specific MSK cluster."""
        region = region or get_default_region()
        client = get_client("kafka", region)
        eol_data = get_eol_schedule("msk")
        resp = client.describe_cluster_v2(ClusterArn=cluster_arn)
        c = resp["ClusterInfo"]
        provisioned = c.get("Provisioned", {})
        kafka_version = provisioned.get("CurrentBrokerSoftwareInfo", {}).get("KafkaVersion", "serverless")
        eol = eol_data.get(kafka_version, {})
        return {
            "cluster_name": c.get("ClusterName"),
            "cluster_type": c.get("ClusterType"),
            "kafka_version": kafka_version,
            "state": c.get("State"),
            "arn": c.get("ClusterArn"),
            "region": region,
            "created_at": str(c.get("CreationTime", "")),
            "broker_node_count": provisioned.get("NumberOfBrokerNodes"),
            "broker_instance_type": provisioned.get("BrokerNodeGroupInfo", {}).get("InstanceType"),
            "storage_info": provisioned.get("BrokerNodeGroupInfo", {}).get("StorageInfo"),
            "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
            "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
        }

    @mcp.tool()
    def get_msk_compatible_kafka_versions(cluster_arn: str | None = None, region: str | None = None) -> list[dict]:
        """Get compatible Kafka version upgrades."""
        region = region or get_default_region()
        client = get_client("kafka", region)
        kwargs = {}
        if cluster_arn:
            kwargs["ClusterArn"] = cluster_arn
        resp = client.get_compatible_kafka_versions(**kwargs)
        return [{"source_version": cv.get("SourceVersion"), "target_versions": cv.get("TargetVersions", [])} for cv in resp.get("CompatibleKafkaVersions", [])]
