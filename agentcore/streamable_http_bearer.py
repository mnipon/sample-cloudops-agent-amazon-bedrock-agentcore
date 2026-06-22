"""
Bearer-token authentication for MCP streamable HTTP connections.

Companion to ``streamable_http_sigv4.py``. Where the SigV4 transport signs
Gateway requests with the runtime's own IAM principal, this transport forwards
a per-user JWT as an ``Authorization: Bearer <token>`` header so the Gateway
can derive the user's role from verified JWT claims.

The token is forwarded byte-for-byte unmodified.
"""

from mcp.client.streamable_http import streamablehttp_client
from contextlib import asynccontextmanager


@asynccontextmanager
async def streamablehttp_client_with_bearer(
    url: str,
    token: str,
    timeout: float = 30.0,
):
    """
    Create a streamable HTTP MCP client that authenticates with a Bearer token.

    The supplied ``token`` is attached unmodified as the ``Authorization``
    header value (prefixed with ``Bearer ``). The transport performs no
    substitution, trimming, or mutation of the token, so the Gateway receives
    exactly the identity the caller provided.

    Args:
        url: Gateway endpoint URL
        token: User JWT to forward as the Bearer credential (unmodified)
        timeout: Request timeout in seconds

    Yields:
        MCP client session authenticated with the Bearer token
    """
    headers = {"Authorization": f"Bearer {token}"}

    async with streamablehttp_client(url, headers=headers, timeout=timeout) as client:
        yield client
