"""Integration test (Task 9.6): Missing identity defaults to NonAdmin.

Feature: gateway-tool-access-control
Requirements: 7.4

WHAT THIS VERIFIES
------------------
Requirement 7.4 says that when the Gateway receives a request with **no
resolvable user identity** (specifically: no role claim, or an unrecognized
role value), the Gateway SHALL apply the NonAdmin role and SHALL NOT reject the
request *solely because the Role_Claim is absent*.

IMPORTANT NUANCE — the Gateway uses ``CUSTOM_JWT`` inbound authorization:
A *totally unauthenticated* request (no/garbage JWT) is rejected at JWT
validation — that is expected and is covered by the JWT-validation integration
test (Task 9.2). It is NOT what Req 7.4 is about.

The "missing identity -> NonAdmin" case Req 7.4 describes is a token that is
**valid for the Gateway's JWT authorizer but carries NO ``role`` claim** (or an
unknown/unrecognized role). For such a token the Gateway must:

  (a) NOT reject the request for the missing role claim — i.e. ``tools/list``
      succeeds (no 401/403 attributable to the absent role), and
  (b) treat the user as **NonAdmin** — discovery returns ONLY billing/pricing
      tools and ZERO cloudwatch/cloudtrail/inventory tools; and (optionally, if
      a denied tool name is supplied) invoking a denied-category tool is denied.

Because these assertions exercise the deployed Gateway + Cedar Policy engine,
the whole module AUTO-SKIPS unless the required infrastructure environment is
present. It must never fail when the infra env vars are absent, and it never
requires live infra merely to be imported or collected.

--------------------------------------------------------------------------------
Required environment variables (test runs only when ALL are present):
--------------------------------------------------------------------------------
  INTEGRATION_TEST_ENABLED
      Master switch. Set to a truthy value ("1", "true", "yes", "on") to opt in
      to live integration testing.

  Gateway endpoint (one of):
      GATEWAY_URL   Full MCP endpoint URL, e.g.
                    https://<gatewayId>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp
      GATEWAY_ARN   Gateway ARN; the MCP endpoint is derived from it using
                    AWS_REGION / AWS_DEFAULT_REGION (default "us-east-1").

  NO_ROLE_COGNITO_TOKEN
      A Cognito access token (JWT) that is VALID for the Gateway's JWT
      authorizer (correct issuer / client_id via AllowedClients / signature)
      but carries NO ``role``
      claim — or an unknown/unrecognized role value. This is the crux of Req
      7.4: such a token must be accepted (not rejected for the missing claim)
      and treated as NonAdmin. The token is forwarded unmodified as
      ``Authorization: Bearer <token>``.

--------------------------------------------------------------------------------
Optional environment variables:
--------------------------------------------------------------------------------
  DENIED_TOOL_NAME
      A specific denied-category tool name to additionally attempt invoking
      (e.g. "cloudwatchMcp___get_metric_data"). When set, the test also asserts
      the no-role token is DENIED when invoking it (confirming NonAdmin
      treatment at invocation time, not just discovery). When unset, the test
      verifies NonAdmin treatment via discovery filtering only.

  GATEWAY_REQUEST_TIMEOUT
      Per-request timeout in seconds (default: 30).

If any required variable is missing the module is SKIPPED with a message naming
what is absent. It never fails due to missing infrastructure.

Run only this test:
  cd agentcore && python -m pytest tests/integration/test_missing_identity_nonadmin_integration.py -v
"""

from __future__ import annotations

import asyncio
import os
import sys

import pytest

# Make the parent ``agentcore`` package importable regardless of the working
# directory (the transport / model modules under test sit two levels up).
sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)


# --- Tool-name prefixes (from design Data Models: Tool categories) -----------

ALLOWED_PREFIXES = ("billingMcp___", "pricingMcp___")
DENIED_PREFIXES = ("cloudwatchMcp___", "cloudtrailMcp___", "inventoryMcp___")

# The Gateway semantic-search meta-tool; it is not a category-bearing tool and
# is permitted to surface in a discovery listing.
SEARCH_TOOL_NAME = "x_amz_bedrock_agentcore_search"


# --- Environment / skip gating -----------------------------------------------

_TRUTHY = {"1", "true", "yes", "on"}


def _truthy(value) -> bool:
    return bool(value) and str(value).strip().lower() in _TRUTHY


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
    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    ).strip()
    if not gateway_id:
        return None
    return (
        f"https://{gateway_id}.gateway.bedrock-agentcore."
        f"{region}.amazonaws.com/mcp"
    )


INTEGRATION_ENABLED = _truthy(os.environ.get("INTEGRATION_TEST_ENABLED"))
GATEWAY_URL = _resolve_gateway_url()
NO_ROLE_TOKEN = (os.environ.get("NO_ROLE_COGNITO_TOKEN") or "").strip()

_missing = []
if not INTEGRATION_ENABLED:
    _missing.append("INTEGRATION_TEST_ENABLED")
if not GATEWAY_URL:
    _missing.append("GATEWAY_URL (or GATEWAY_ARN)")
if not NO_ROLE_TOKEN:
    _missing.append("NO_ROLE_COGNITO_TOKEN")

SKIP_REASON = (
    "Live Gateway integration test (missing-identity -> NonAdmin); "
    "missing required environment: " + ", ".join(_missing)
    if _missing
    else ""
)

# Module-level skip: collected cleanly, never fails, when infra env is absent.
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(bool(_missing), reason=SKIP_REASON),
]


def _timeout() -> float:
    try:
        return float(os.environ.get("GATEWAY_REQUEST_TIMEOUT", "30"))
    except ValueError:
        return 30.0


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


def _result_text(result) -> str:
    """Flatten an MCP tool result's text content for inspection."""
    parts: list[str] = []
    content = getattr(result, "content", None) or []
    for item in content:
        text = getattr(item, "text", None)
        if text:
            parts.append(str(text))
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        parts.append(str(structured))
    return " ".join(parts)


# --- Tests -------------------------------------------------------------------

def test_no_role_token_accepted_and_treated_as_nonadmin():
    """A valid token lacking a role claim is accepted and treated as NonAdmin.

    Asserts (Req 7.4):
      (a) the request is NOT rejected for the missing role claim — the
          ``tools/list`` call succeeds (no auth error), and
      (b) the user is treated as NonAdmin — discovery returns ONLY billing /
          pricing tools and ZERO cloudwatch / cloudtrail / inventory tools.

    Validates: Requirements 7.4
    """
    from mcp import ClientSession  # imported lazily so collection never needs it

    from streamable_http_bearer import streamablehttp_client_with_bearer

    async def _run():
        # (a) The connection + tools/list must SUCCEED. If the Gateway rejected
        # the token for the missing role claim, this context / call would raise;
        # surfacing that as a test failure (not a skip) is the point of Req 7.4.
        try:
            async with streamablehttp_client_with_bearer(
                url=GATEWAY_URL,
                token=NO_ROLE_TOKEN,
                timeout=_timeout(),
            ) as transport:
                # The streamable-http transport yields (read, write, *extra).
                read_stream, write_stream = transport[0], transport[1]
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    return await _collect_listed_tool_names(session)
        except BaseException as exc:  # noqa: BLE001 - classify for a clear failure
            pytest.fail(
                "A valid token with no role claim must NOT be rejected for the "
                "missing claim — tools/list should succeed and the user be "
                f"treated as NonAdmin (Req 7.4). The call raised: {exc!r}"
            )

    listed = asyncio.run(_run())

    # (b) NonAdmin treatment: only billing/pricing surfaced; none of the denied
    # categories appear.
    assert listed, (
        "Expected at least the billing/pricing tools to be discoverable for a "
        "no-role (NonAdmin) token — got an empty tool list."
    )

    denied_hits = [
        name for name in listed
        if any(name.startswith(p) for p in DENIED_PREFIXES)
    ]
    assert not denied_hits, (
        "A no-role token must be treated as NonAdmin: discovery surfaced "
        f"DENIED-category tools (cloudwatch/cloudtrail/inventory): {denied_hits}"
    )

    unexpected = [
        name for name in listed
        if not name.startswith(ALLOWED_PREFIXES) and name != SEARCH_TOOL_NAME
    ]
    assert not unexpected, (
        "A no-role token (NonAdmin) must only discover billing/pricing tools; "
        f"these are outside the allowed set: {unexpected}"
    )


def test_no_role_token_denied_when_invoking_denied_tool():
    """A no-role token is denied when invoking a denied-category tool (Req 7.4).

    This optional, stronger assertion confirms NonAdmin treatment at *invocation*
    time (not only discovery). It runs only when ``DENIED_TOOL_NAME`` names a
    concrete cloudwatch/cloudtrail/inventory tool for the deployment; otherwise
    it is skipped. The success path (`test_no_role_token_accepted_and_treated_
    as_nonadmin`) already proves NonAdmin via discovery filtering.

    Validates: Requirements 7.4
    """
    denied_tool = (os.environ.get("DENIED_TOOL_NAME") or "").strip()
    if not denied_tool:
        pytest.skip(
            "DENIED_TOOL_NAME not set — invocation-time NonAdmin check skipped; "
            "discovery-time check already proves NonAdmin treatment."
        )

    from mcp import ClientSession

    from streamable_http_bearer import streamablehttp_client_with_bearer
    from authorization_model import is_authorization_denial

    async def _run():
        async with streamablehttp_client_with_bearer(
            url=GATEWAY_URL,
            token=NO_ROLE_TOKEN,
            timeout=_timeout(),
        ) as transport:
            read_stream, write_stream = transport[0], transport[1]
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                try:
                    result = await session.call_tool(denied_tool, {})
                except Exception as exc:  # noqa: BLE001 - classify below
                    return "denied" if is_authorization_denial(exc) else "error", repr(exc)
                # Some servers signal tool-level errors via ``isError``.
                text = _result_text(result)
                if getattr(result, "isError", False) and is_authorization_denial(text):
                    return "denied", text
                return "result", text

    outcome, detail = asyncio.run(_run())

    assert outcome != "error", (
        f"Invocation of '{denied_tool}' raised a non-authorization error, so "
        "NonAdmin denial could not be evaluated for the no-role token. Set "
        f"DENIED_TOOL_NAME to a known denied tool for this deployment: {detail}"
    )
    assert outcome == "denied", (
        f"A no-role (NonAdmin) token invoking denied-category tool "
        f"'{denied_tool}' must be DENIED, not return a result (Req 7.4). "
        f"Got: {detail!r}"
    )
