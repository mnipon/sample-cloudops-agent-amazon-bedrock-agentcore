from mcp.server.fastmcp import FastMCP
from ..aws_client import get_client, get_default_region, get_all_regions
from ..eol_reader import get_eol_schedule


def _match_eol(version: str, eol_data: dict) -> dict:
    """Match a version against EOL data. Tries exact, then major.minor, then major."""
    if version in eol_data:
        return eol_data[version]
    parts = version.split(".")
    if len(parts) >= 2:
        major_minor = parts[0] + "." + parts[1]
        if major_minor in eol_data:
            return eol_data[major_minor]
    if parts[0] in eol_data:
        return eol_data[parts[0]]
    return {}


def register_rds_tools(mcp: FastMCP):
    @mcp.tool()
    def list_rds_instances(region: str | None = None) -> list[dict]:
        """List all RDS DB instances with engine version, status, ARN, and end-of-support dates. Scans all regions if region not specified."""
        regions = [region] if region else get_all_regions()
        results = []
        for r in regions:
            try:
                client = get_client("rds", r)
                paginator = client.get_paginator("describe_db_instances")
                for page in paginator.paginate():
                    for db in page["DBInstances"]:
                        engine = db["Engine"]
                        eol_data = get_eol_schedule(f"rds-{engine}")
                        eol = _match_eol(db["EngineVersion"], eol_data)
                        results.append({
                            "identifier": db["DBInstanceIdentifier"],
                            "engine": engine,
                            "engine_version": db["EngineVersion"],
                            "status": db["DBInstanceStatus"],
                            "arn": db["DBInstanceArn"],
                            "region": r,
                            "instance_class": db.get("DBInstanceClass"),
                            "multi_az": db.get("MultiAZ"),
                            "created_at": str(db.get("InstanceCreateTime", "")),
                            "endpoint": db.get("Endpoint", {}).get("Address"),
                            "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
                            "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
                        })
            except Exception:
                continue
        return results

    @mcp.tool()
    def list_rds_clusters(region: str | None = None) -> list[dict]:
        """List all RDS Aurora DB clusters with engine version, status, ARN, and end-of-support dates. Scans all regions if region not specified."""
        regions = [region] if region else get_all_regions()
        results = []
        for r in regions:
            try:
                client = get_client("rds", r)
                paginator = client.get_paginator("describe_db_clusters")
                for page in paginator.paginate():
                    for cl in page["DBClusters"]:
                        engine = cl["Engine"]
                        eol_data = get_eol_schedule(f"aurora-{engine.replace('aurora-', '')}")
                        eol = _match_eol(cl["EngineVersion"], eol_data)
                        results.append({
                            "identifier": cl["DBClusterIdentifier"],
                            "engine": engine,
                            "engine_version": cl["EngineVersion"],
                            "status": cl["Status"],
                            "arn": cl["DBClusterArn"],
                            "region": r,
                            "multi_az": cl.get("MultiAZ"),
                            "created_at": str(cl.get("ClusterCreateTime", "")),
                            "endpoint": cl.get("Endpoint"),
                            "reader_endpoint": cl.get("ReaderEndpoint"),
                            "end_of_standard_support": eol.get("end_of_standard_support", "Unknown"),
                            "end_of_extended_support": eol.get("end_of_extended_support", "Unknown"),
                        })
            except Exception:
                continue
        return results

    @mcp.tool()
    def get_rds_engine_versions(engine: str = "mysql", region: str | None = None) -> list[dict]:
        """Get available RDS engine versions. Engine: mysql, postgres, aurora-mysql, aurora-postgresql, etc."""
        region = region or get_default_region()
        client = get_client("rds", region)
        paginator = client.get_paginator("describe_db_engine_versions")
        results = []
        for page in paginator.paginate(Engine=engine):
            for v in page["DBEngineVersions"]:
                results.append({
                    "engine": v["Engine"],
                    "engine_version": v["EngineVersion"],
                    "status": v.get("Status", "available"),
                    "db_parameter_group_family": v.get("DBParameterGroupFamily"),
                })
        return results
