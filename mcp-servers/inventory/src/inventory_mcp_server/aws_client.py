import os
import boto3

def get_default_region() -> str:
    return os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

def get_client(service: str, region: str | None = None):
    return boto3.client(service, region_name=region or get_default_region())

def get_all_regions() -> list[str]:
    """Get all enabled AWS regions for the current account."""
    client = boto3.client("ec2", region_name=get_default_region())
    resp = client.describe_regions(AllRegions=False)
    return [r["RegionName"] for r in resp["Regions"]]
