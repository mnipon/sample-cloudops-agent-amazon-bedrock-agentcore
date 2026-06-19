from mcp.server.fastmcp import FastMCP
from ..aws_client import get_client, get_default_region, get_all_regions
from ..eol_reader import get_eol_schedule


def register_elasticache_tools(mcp: FastMCP):
    @mcp.tool()
    def list_elasticache_clusters(region: str | None = None) -> list[dict]:
        """List all ElastiCache clusters with version, status, ARN, and end-of-support dates. Scans all regions if region not specified."""
        regions = [region] if region else get_all_regions()
        results = []
        for r in regions:
            try:
                client = get_client("elasticache", r)
                paginator = client.get_paginator("describe_cache_clusters")
                for page in paginator.paginate(ShowCacheNodeInfo=True):
                    for c in page["CacheClusters"]:
                        engine = c.get("Engine", "redis")
                        eol_data = get_eol_schedule(f"elasticache-{engine}")
                        version = c.get("EngineVersion", "")
                        major_minor = ".".join(version.split(".")[:2]) if version else ""
                        eol = eol_data.get(major_minor, eol_data.get(version, {}))
                        results.append({
                            "cluster_id": c["CacheClusterId"],
                            "engine": engine,
                            "engine_version": version,
                            "status": c.get("CacheClusterStatus"),
                            "arn": c.get("ARN"),
                            "region": r,
                            "node_type": c.get("CacheNodeType"),
                            "num_nodes": c.get("NumCacheNodes"),
                            "created_at": str(c.get("CacheClusterCreateTime", "")),
                            "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
                            "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
                        })
            except Exception:
                continue
        return results

    @mcp.tool()
    def list_elasticache_replication_groups(region: str | None = None) -> list[dict]:
        """List ElastiCache replication groups (Redis/Valkey). Scans all regions if region not specified."""
        regions = [region] if region else get_all_regions()
        results = []
        for r in regions:
            try:
                client = get_client("elasticache", r)
                paginator = client.get_paginator("describe_replication_groups")
                for page in paginator.paginate():
                    for rg in page["ReplicationGroups"]:
                        results.append({
                            "replication_group_id": rg["ReplicationGroupId"],
                            "description": rg.get("Description"),
                            "status": rg.get("Status"),
                            "arn": rg.get("ARN"),
                            "region": r,
                            "member_clusters": rg.get("MemberClusters", []),
                            "multi_az": rg.get("MultiAZ"),
                            "cluster_enabled": rg.get("ClusterEnabled"),
                        })
            except Exception:
                continue
        return results

    @mcp.tool()
    def get_elasticache_engine_versions(engine: str = "redis", region: str | None = None) -> list[dict]:
        """Get available ElastiCache engine versions. Engine: redis, memcached, valkey."""
        region = region or get_default_region()
        client = get_client("elasticache", region)
        resp = client.describe_cache_engine_versions(Engine=engine)
        return [{"engine": v.get("Engine"), "engine_version": v.get("EngineVersion"), "cache_parameter_group_family": v.get("CacheParameterGroupFamily")} for v in resp.get("CacheEngineVersions", [])]
