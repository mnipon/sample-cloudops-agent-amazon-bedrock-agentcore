def test_server_imports():
    """Test that the server module can be imported successfully."""
    from inventory_mcp_server.server import mcp
    assert mcp is not None
    assert mcp.name == "inventory-mcp-server"


def test_aws_client():
    """Test aws_client helper functions."""
    from inventory_mcp_server.aws_client import get_default_region
    import os
    os.environ["AWS_REGION"] = "ap-southeast-1"
    assert get_default_region() == "ap-southeast-1"
    del os.environ["AWS_REGION"]
