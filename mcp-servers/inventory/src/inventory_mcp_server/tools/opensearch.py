from mcp.server.fastmcp import FastMCP
from ..aws_client import get_client, get_default_region, get_all_regions
from ..eol_reader import get_eol_schedule


def register_opensearch_tools(mcp: FastMCP):
    @mcp.tool()
    def list_opensearch_domains(region: str | None = None) -> list[dict]:
        """List all OpenSearch domains with version, status, ARN, and end-of-support dates. Scans all regions if region not specified."""
        regions = [region] if region else get_all_regions()
        eol_data = get_eol_schedule("opensearch")
        results = []
        for r in regions:
            try:
                client = get_client("opensearch", r)
                names = [d["DomainName"] for d in client.list_domain_names().get("DomainNames", [])]
                if not names:
                    continue
                domains = client.describe_domains(DomainNames=names)["DomainStatusList"]
                for d in domains:
                    version = d.get("EngineVersion", "")
                    short_ver = version.split("_")[-1] if "_" in version else version
                    eol = eol_data.get(short_ver, {})
                    results.append({
                        "domain_name": d["DomainName"],
                        "engine_version": version,
                        "arn": d["ARN"],
                        "region": r,
                        "processing": d.get("Processing"),
                        "created": d.get("Created"),
                        "endpoint": d.get("Endpoint") or d.get("Endpoints", {}).get("vpc"),
                        "instance_type": d.get("ClusterConfig", {}).get("InstanceType"),
                        "instance_count": d.get("ClusterConfig", {}).get("InstanceCount"),
                        "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
                        "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
                    })
            except Exception:
                continue
        return results

    @mcp.tool()
    def get_opensearch_compatible_versions(domain_name: str | None = None, region: str | None = None) -> list[dict]:
        """Get compatible OpenSearch upgrade paths."""
        region = region or get_default_region()
        client = get_client("opensearch", region)
        kwargs = {}
        if domain_name:
            kwargs["DomainName"] = domain_name
        resp = client.get_compatible_versions(**kwargs)
        return [{"source_version": cv.get("SourceVersion"), "target_versions": cv.get("TargetVersions", [])} for cv in resp.get("CompatibleVersions", [])]

    @mcp.tool()
    def list_opensearch_versions(region: str | None = None) -> list[str]:
        """List all available OpenSearch engine versions."""
        region = region or get_default_region()
        client = get_client("opensearch", region)
        return client.list_versions().get("Versions", [])
