"""Integration test (Task 9.8): Allowed-target-unavailable behavior.

Feature: gateway-tool-access-control

WHAT THIS VERIFIES
------------------
When an *allowed* tool category's backing MCP server target is unavailable or
non-responsive, the deployed Gateway returns a TARGET-UNAVAILABLE error rather
than an authorization denial, and the failure does NOT alter the user's allowed
categories. Specifically (Req 2.4, 3.4):

  * Invoking an ALLOWED tool (billing or pricing for a Non-Admin; any of the
    five for an Admin) whose backing target is down yields a target-unavailable
    / timeout error -- NOT an ``AuthorizeActionException`` / access-denial.
    The two are distinguished with
    ``authorization_model.is_authorization_denial``, which MUST be ``False`` for
    a target-unavailable error (Req 2.4, 3.4).
  * The error is returned within a bounded time (~30s per Req 3.4 for the
    Non-Admin billing/pricing case): the call terminates instead of hanging.
  * The user's allowed categories are UNCHANGED after the failure: a subsequent
    ``tools/list`` still returns the billing/pricing categories (Req 3.4 "...
    without altering the user's Allowed_Categories").

This is an END-TO-END test against the *live deployed* Gateway + Policy engine
and a real Cognito-issued access token. It additionally depends on an allowed
category's backing MCP target being *unavailable*, which cannot be arranged in
a generic environment. It therefore AUTO-SKIPS unless BOTH the standard
integration infra is configured AND an explicit opt-in naming the
known-unavailable allowed tool is provided. When skipped the file still
collects cleanly, keeping the suite green in CI without infra.

REQUIRED ENVIRONMENT VARIABLES
------------------------------
The test runs only when ALL of the following are set; otherwise it SKIPS.

  INTEGRATION_TEST_ENABLED
      Master switch. Must be truthy ("1", "true", "yes", "on") to opt in to
      live integration testing.

  GATEWAY_URL   (or)   GATEWAY_ARN
      The deployed Gateway MCP endpoint. Provide either the full MCP URL via
      GATEWAY_URL (e.g.
      "https://<gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp")
      or GATEWAY_ARN, from which the endpoint URL is derived (the region is
      taken from AWS_REGION / AWS_DEFAULT_REGION).

  An access token -- provide ONE of (checked in this order):
      ALLOWED_TARGET_ACCESS_TOKEN   Any valid Cognito access token whose role
                                    is allowed the target tool's category.
      NONADMIN_ACCESS_TOKEN         A Non-Admin Cognito JWT (billing/pricing are
                                    allowed for Non-Admin -- the Req 3.4 case).
      ADMIN_COGNITO_TOKEN / ADMIN_ACCESS_TOKEN
                                    An Admin Cognito JWT (all five allowed).
      The token is forwarded unmodified as ``Authorization: Bearer <token>``.

  UNAVAILABLE_TARGET_TEST_ENABLED
      Explicit opt-in for THIS scenario. Must be truthy. Because making an
      allowed target unavailable requires deliberately arranging a down/
      non-responsive backing MCP server (or a paused/blackholed target), this
      flag confirms the operator has set that up. Without it the test SKIPS.

  UNAVAILABLE_ALLOWED_TOOL_NAME
      The Gateway tool name of an ALLOWED (billing or pricing) tool whose
      backing MCP target is KNOWN-UNAVAILABLE for this run (e.g.
      "billingMcp___get_cost_and_usage"). The tool's category, recovered from
      its ``<targetName>___`` prefix, must be one that the supplied token's role
      is allowed (billing/pricing for Non-Admin). If it is not an allowed
      category the test SKIPS with a clear reason (a denied tool would produce
      an authorization error, not a target-unavailable error, and so would not
      exercise this scenario).

OPTIONAL ENVIRONMENT VARIABLES
------------------------------
  AWS_REGION / AWS_DEFAULT_REGION
      Region used to derive the endpoint from GATEWAY_ARN. Defaults to
      "us-east-1" when neither is set and GATEWAY_URL is not provided.

  INTEGRATION_TEST_TIMEOUT
      Per-call timeout in seconds (default 30, matching the Req 3.4 bound).

Validates: Requirements 2.4, 3.4
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

import pytest

# Make the parent ``agentcore`` package importable when the test is run from an
# arbitrary working directory (the modules under test sit two levels up).
sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)


# ---------------------------------------------------------------------------
# Environment-driven skip configuration
# ---------------------------------------------------------------------------

_TRUTHY = {"1", "true", "yes", "on"}

# Categories that are allowed for EVERY authenticated role (billing/pricing).
# A target-unavailable error for one of these is the Req 3.4 (Non-Admin) /
# Req 2.4 (Admin) scenario; only these are guaranteed to be "allowed" for the
# Non-Admin token path.
_UNIVERSALLY_ALLOWED_CATEGORIES = {"billing", "pricing"}


def _is_truthy(value) -> bool:
    return bool(value) and str(value).strip().lower() in _TRUTHY


def _derive_gateway_url() -> "str | None":
    """Resolve the Gateway MCP endpoint from GATEWAY_URL or GATEWAY_ARN."""
    url = os.environ.get("GATEWAY_URL")
    if url and url.strip():
        return url.strip()
    arn = os.environ.get("GATEWAY_ARN")
    if not arn:
        return None
    gateway_id = arn.split("/")[-1]
    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    )
    return f"https://{gateway_id}.gateway.bedrock-agentcore.{region}.amazonaws.com/mcp"


def _resolve_token() -> "str | None":
    """Resolve a Cognito access token whose role is allowed the target tool."""
    for var in (
        "ALLOWED_TARGET_ACCESS_TOKEN",
        "NONADMIN_ACCESS_TOKEN",
        "ADMIN_COGNITO_TOKEN",
        "ADMIN_ACCESS_TOKEN",
    ):
        token = os.environ.get(var)
        if token and token.strip():
            return token.strip()
    return None


def _missing_requirements() -> "list[str]":
    """Return the list of unmet preconditions; empty list means ready to run."""
    missing: "list[str]" = []
    if not _is_truthy(os.environ.get("INTEGRATION_TEST_ENABLED")):
        missing.append("INTEGRATION_TEST_ENABLED (set to 1/true to enable)")
    if not _derive_gateway_url():
        missing.append("GATEWAY_URL or GATEWAY_ARN")
    if not _resolve_token():
        missing.append(
            "an access token (ALLOWED_TARGET_ACCESS_TOKEN / NONADMIN_ACCESS_TOKEN "
            "/ ADMIN_COGNITO_TOKEN)"
        )
    if not _is_truthy(os.environ.get("UNAVAILABLE_TARGET_TEST_ENABLED")):
        missing.append(
            "UNAVAILABLE_TARGET_TEST_ENABLED (opt-in: an allowed target must be "
            "deliberately made unavailable for this scenario)"
        )
    if not (os.environ.get("UNAVAILABLE_ALLOWED_TOOL_NAME") or "").strip():
        missing.append(
            "UNAVAILABLE_ALLOWED_TOOL_NAME (an allowed billing/pricing tool whose "
            "backing target is known-unavailable)"
        )
    return missing


# Evaluated at import/collection time so the whole module skips cleanly when the
# deployed infrastructure / scenario opt-in is not configured.
_MISSING = _missing_requirements()

pytestmark = pytest.mark.skipif(
    bool(_MISSING),
    reason=(
        "Live allowed-target-unavailable integration test (Req 2.4, 3.4); "
        "missing required configuration: " + ", ".join(_MISSING)
    ),
)


# ---------------------------------------------------------------------------
# Live helpers
# ---------------------------------------------------------------------------

async def _invoke_tool(url: str, token: str, tool_name: str, timeout: float):
    """Attempt a ``tools/call`` of ``tool_name``.

    Returns one of:
      ("denied", detail)      — the Gateway raised an authorization denial.
      ("unavailable", detail) — a non-authorization failure (target unavailable
                                / timeout / connection error).
      ("result", result_obj)  — the call returned a successful result.

    Uses the project's Bearer transport so the user JWT is forwarded unmodified,
    exactly as the Agent Runtime does in production.
    """
    from mcp import ClientSession

    from streamable_http_bearer import streamablehttp_client_with_bearer
    from authorization_model import is_authorization_denial

    try:
        async with streamablehttp_client_with_bearer(
            url=url, token=token, timeout=timeout
        ) as transport:
            read_stream, write_stream = transport[0], transport[1]
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, {})
                if getattr(result, "isError", False):
                    text = _result_text(result)
                    if is_authorization_denial(text):
                        return "denied", text
                    return "unavailable", text
                return "result", result
    except Exception as exc:  # noqa: BLE001 - we classify below
        if is_authorization_denial(exc):
            return "denied", repr(exc)
        # Anything else (timeout, connection refused, 5xx, target-unavailable)
        # is treated as the target being unavailable / non-responsive.
        return "unavailable", repr(exc)


async def _list_tool_names(url: str, token: str, timeout: float) -> "list[str]":
    """Return the discovered Gateway tool names for ``token``."""
    from mcp import ClientSession

    from streamable_http_bearer import streamablehttp_client_with_bearer

    names: "list[str]" = []
    async with streamablehttp_client_with_bearer(
        url=url, token=token, timeout=timeout
    ) as transport:
        read_stream, write_stream = transport[0], transport[1]
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            cursor = None
            while True:
                page = await session.list_tools(cursor=cursor)
                for tool in getattr(page, "tools", []) or []:
                    name = getattr(tool, "name", None)
                    if name:
                        names.append(str(name))
                cursor = getattr(page, "nextCursor", None)
                if not cursor:
                    break
    return names


def _result_text(result) -> str:
    """Flatten an MCP tool result's text content for inspection."""
    parts: "list[str]" = []
    content = getattr(result, "content", None) or []
    for item in content:
        text = getattr(item, "text", None)
        if text:
            parts.append(str(text))
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        parts.append(str(structured))
    return " ".join(parts)


# ---------------------------------------------------------------------------
# The test
# ---------------------------------------------------------------------------

def test_allowed_target_unavailable_returns_target_unavailable_not_denial():
    """An unavailable ALLOWED target yields a target-unavailable error (not a
    denial), within ~30s, and leaves allowed categories unchanged.

    Asserts (Req 2.4, 3.4):
      * the failure is classified as target-unavailable, NOT an authorization
        denial (``is_authorization_denial`` is False for the error),
      * the call terminates within the bounded timeout (~30s for the Non-Admin
        billing/pricing case), and
      * a subsequent ``tools/list`` still returns the billing/pricing
        categories -- the user's allowed categories are unchanged.
    """
    from authorization_model import extract_denied_category

    url = _derive_gateway_url()
    token = _resolve_token()
    tool_name = os.environ["UNAVAILABLE_ALLOWED_TOOL_NAME"].strip()
    timeout = float(os.environ.get("INTEGRATION_TEST_TIMEOUT", "30"))

    # The target tool must belong to an allowed category, otherwise the Gateway
    # would return an authorization error (a different scenario, covered by the
    # Non-Admin denial test). Recover the category from the tool-name prefix.
    category = extract_denied_category(tool_name)
    if category not in _UNIVERSALLY_ALLOWED_CATEGORIES:
        pytest.skip(
            f"UNAVAILABLE_ALLOWED_TOOL_NAME={tool_name!r} resolves to category "
            f"{category!r}, which is not a universally-allowed (billing/pricing) "
            "category. Set it to a billing/pricing tool so the call is allowed "
            "and the unavailable-target path (not an auth denial) is exercised."
        )

    # --- Invoke the allowed-but-unavailable tool, timing the call. ---------
    started = time.monotonic()
    outcome, detail = asyncio.run(_invoke_tool(url, token, tool_name, timeout))
    elapsed = time.monotonic() - started

    # It MUST NOT be an authorization denial: the category is allowed, so any
    # failure is about target availability, not authorization (Req 2.4, 3.4).
    assert outcome != "denied", (
        f"Invocation of allowed tool '{tool_name}' ({category}) returned an "
        f"authorization denial, but an allowed category must never be denied; "
        f"a down target must surface as target-unavailable instead: {detail!r}"
    )

    # The intended scenario is that the target is unavailable. If it actually
    # responded, the operator's precondition (target made unavailable) was not
    # met -- skip rather than emit a misleading failure.
    if outcome == "result":
        pytest.skip(
            f"Allowed tool '{tool_name}' returned a successful result; its "
            "backing target was reachable. To exercise Req 2.4/3.4, point "
            "UNAVAILABLE_ALLOWED_TOOL_NAME at a tool whose target is actually "
            "unavailable for this run."
        )

    assert outcome == "unavailable", (
        f"Expected a target-unavailable error for '{tool_name}', got "
        f"{outcome!r}: {detail!r}"
    )

    # The error must indicate unavailability rather than authorization. We
    # double-check the recovered classification is not an auth denial.
    from authorization_model import is_authorization_denial

    assert not is_authorization_denial(detail), (
        f"Target-unavailable error for '{tool_name}' must not be classified as "
        f"an authorization denial: {detail!r} (Req 2.4, 3.4)."
    )

    # The invocation must terminate within the bounded time (~30s, Req 3.4),
    # with a small allowance for client teardown overhead.
    assert elapsed <= timeout + 10.0, (
        f"Invocation of '{tool_name}' did not terminate within the bounded "
        f"time: took {elapsed:.1f}s (timeout {timeout:.0f}s) (Req 3.4)."
    )

    # --- Allowed categories must be unchanged after the failure. -----------
    names = asyncio.run(_list_tool_names(url, token, timeout))
    assert names, "tools/list returned no tools after the unavailable-target call"

    for allowed in _UNIVERSALLY_ALLOWED_CATEGORIES:
        prefix = f"{allowed}Mcp___"
        assert any(name.startswith(prefix) for name in names), (
            f"After the target-unavailable failure, allowed category "
            f"'{allowed}' is missing from discovery; the user's allowed "
            f"categories must be unchanged (Req 3.4). Observed: {sorted(names)}"
        )
