"""
Integration test — Task 9.4: Non-Admin discovery (including semantic search).

Feature: gateway-tool-access-control
Requirements: 3.2, 4.2

This is a LIVE integration test. It connects an MCP client to the deployed
AgentCore Gateway using a NON-ADMIN user's Cognito access token (forwarded as
``Authorization: Bearer <token>`` via ``streamablehttp_client_with_bearer``) and
asserts that the Non-Admin role can only discover the billing and pricing tool
categories:

  (a) ``tools/list`` (paginated) returns ONLY tools prefixed ``billingMcp___``
      or ``pricingMcp___`` and ZERO tools prefixed ``cloudwatchMcp___``,
      ``cloudtrailMcp___`` or ``inventoryMcp___`` (Req 3.2, 4.2).

  (b) The Gateway semantic-search meta-tool ``x_amz_bedrock_agentcore_search``,
      queried with phrases that would surface the denied categories
      ("describe log groups", "lookup cloudtrail events", "list clusters", ...),
      returns NO tool names belonging to the denied categories (Req 4.2 —
      discovery filtering applies to semantic search).

Because the assertions exercise the deployed Gateway + Cedar Policy engine, the
whole module is SKIPPED unless the required infrastructure environment is
present. It must never fail when the infra env vars are absent.

Required environment variables (test runs only when ALL are present):

  INTEGRATION_TEST_ENABLED   Must be a truthy value ("1", "true", "yes", "on")
                             to opt in to live integration tests.
  GATEWAY_URL                The Gateway MCP endpoint URL. If unset, it is
                             derived from GATEWAY_ARN (see below).
  GATEWAY_ARN                Optional alternative to GATEWAY_URL. When only the
                             ARN is provided, the MCP endpoint URL is derived
                             as
                             https://<gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp
                             using AWS_REGION (default us-east-1).
  NONADMIN_COGNITO_TOKEN     A NON-ADMIN user's Cognito access token (the JWT
                             carrying role="nonadmin"). Forwarded unmodified as
                             the Bearer credential.

Run only this test:
  cd agentcore && python -m pytest tests/integration/test_nonadmin_discovery_integration.py -v
"""

from __future__ import annotations

import asyncio
import os
import sys

import pytest

# Make the parent ``agentcore`` package importable regardless of the working
# directory (the transport module under test sits two levels up).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


# --- Tool-name prefixes (from design Data Models: Tool categories) -----------

ALLOWED_PREFIXES = ("billingMcp___", "pricingMcp___")
DENIED_PREFIXES = ("cloudwatchMcp___", "cloudtrailMcp___", "inventoryMcp___")

# Semantic-search queries deliberately chosen to surface DENIED categories.
DENIED_CATEGORY_QUERIES = [
    "describe log groups",
    "get metric data",
    "get active alarms",
    "lookup cloudtrail events",
    "list clusters",
    "cluster versions end of support inventory",
]

SEARCH_TOOL_NAME = "x_amz_bedrock_agentcore_search"


# --- Environment / skip gating -----------------------------------------------

def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _resolve_gateway_url() -> str | None:
    """Return the Gateway MCP endpoint URL from env, or derive it from the ARN."""
    url = (os.environ.get("GATEWAY_URL") or "").strip()
    if url:
        return url

    arn = (os.environ.get("GATEWAY_ARN") or "").strip()
    if not arn:
        return None

    # ARN form: arn:aws:bedrock-agentcore:<region>:<acct>:gateway/<gateway-id>
    gateway_id = arn.split("/")[-1]
    region = (os.environ.get("AWS_REGION") or "us-east-1").strip()
    if not gateway_id:
        return None
    return (
        f"https://{gateway_id}.gateway.bedrock-agentcore."
        f"{region}.amazonaws.com/mcp"
    )


INTEGRATION_ENABLED = _truthy(os.environ.get("INTEGRATION_TEST_ENABLED"))
GATEWAY_URL = _resolve_gateway_url()
NONADMIN_TOKEN = (os.environ.get("NONADMIN_COGNITO_TOKEN") or "").strip()

_missing = []
if not INTEGRATION_ENABLED:
    _missing.append("INTEGRATION_TEST_ENABLED")
if not GATEWAY_URL:
    _missing.append("GATEWAY_URL (or GATEWAY_ARN)")
if not NONADMIN_TOKEN:
    _missing.append("NONADMIN_COGNITO_TOKEN")

SKIP_REASON = (
    "Live Gateway integration test — missing required environment: "
    + ", ".join(_missing)
    if _missing
    else ""
)

# Module-level skip: collected cleanly, never fails, when infra env is absent.
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(bool(_missing), reason=SKIP_REASON),
]


# --- Helpers (only invoked when the test is NOT skipped) ---------------------

def _tool_name(tool) -> str:
    """Best-effort extraction of a tool's name across possible shapes."""
    for attr in ("name", "toolName", "tool_name"):
        value = getattr(tool, attr, None)
        if isinstance(value, str) and value:
            return value
    if isinstance(tool, dict):
        for key in ("name", "toolName", "tool_name"):
            value = tool.get(key)
            if isinstance(value, str) and value:
                return value
    return str(tool)


def _assert_only_allowed(tool_names, context: str):
    """Assert every name is an allowed-prefix and none is a denied-prefix."""
    denied_hits = [
        name for name in tool_names
        if any(name.startswith(p) for p in DENIED_PREFIXES)
    ]
    assert not denied_hits, (
        f"{context}: Non-Admin surfaced DENIED-category tools "
        f"(cloudwatch/cloudtrail/inventory): {denied_hits}"
    )
    unexpected = [
        name for name in tool_names
        if not name.startswith(ALLOWED_PREFIXES)
        and name != SEARCH_TOOL_NAME
    ]
    assert not unexpected, (
        f"{context}: Non-Admin surfaced tools outside billing/pricing: "
        f"{unexpected}"
    )


async def _collect_listed_tool_names(session) -> list[str]:
    """Page through tools/list and return every tool name."""
    names: list[str] = []
    cursor = None
    while True:
        result = await session.list_tools(cursor=cursor)
        for tool in getattr(result, "tools", []) or []:
            names.append(_tool_name(tool))
        cursor = getattr(result, "nextCursor", None)
        if not cursor:
            break
    return names


def _names_from_search_result(result) -> list[str]:
    """Extract tool names from a semantic-search tool-call result.

    The search meta-tool returns structured content describing matching tools.
    Shapes vary, so we walk the result defensively and collect any string that
    looks like a Gateway tool name (carries one of the known target prefixes).
    """
    found: list[str] = []
    known_prefixes = ALLOWED_PREFIXES + DENIED_PREFIXES

    def _walk(node):
        if node is None:
            return
        if isinstance(node, str):
            for token in node.replace(",", " ").replace('"', " ").split():
                if token.startswith(known_prefixes):
                    found.append(token)
            return
        if isinstance(node, dict):
            for value in node.values():
                _walk(value)
            return
        if isinstance(node, (list, tuple)):
            for item in node:
                _walk(item)
            return
        # Pydantic / object shapes — inspect common payload attributes.
        for attr in ("structuredContent", "content", "text", "tools", "name"):
            if hasattr(node, attr):
                _walk(getattr(node, attr))

    _walk(getattr(result, "structuredContent", None))
    _walk(getattr(result, "content", None))
    return found


# --- Test --------------------------------------------------------------------

def test_nonadmin_discovery_only_billing_and_pricing():
    """Non-Admin discovery (list + semantic search) yields billing/pricing only.

    Validates: Requirements 3.2, 4.2
    """
    from mcp import ClientSession  # imported lazily so collection never needs it

    from streamable_http_bearer import streamablehttp_client_with_bearer

    async def _run():
        async with streamablehttp_client_with_bearer(
            url=GATEWAY_URL,
            token=NONADMIN_TOKEN,
        ) as transport:
            # The transport yields (read_stream, write_stream, *extra).
            read_stream, write_stream = transport[0], transport[1]
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                # (a) tools/list (paginated) — billing/pricing only.
                listed = await _collect_listed_tool_names(session)
                assert listed, "Expected at least the billing/pricing tools to be discoverable"
                _assert_only_allowed(listed, "tools/list")

                # (b) semantic search must not surface denied categories.
                for query in DENIED_CATEGORY_QUERIES:
                    try:
                        result = await session.call_tool(
                            SEARCH_TOOL_NAME, {"query": query}
                        )
                    except Exception as exc:  # pragma: no cover - infra dependent
                        pytest.fail(
                            f"semantic search call failed for query {query!r}: {exc}"
                        )
                    surfaced = _names_from_search_result(result)
                    denied_hits = [
                        name for name in surfaced
                        if any(name.startswith(p) for p in DENIED_PREFIXES)
                    ]
                    assert not denied_hits, (
                        f"semantic search query {query!r} surfaced DENIED-category "
                        f"tools for Non-Admin: {denied_hits}"
                    )

    asyncio.run(_run())
