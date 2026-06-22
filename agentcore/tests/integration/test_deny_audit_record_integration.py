"""Integration test (Task 9.7): Deny-audit record.

Feature: gateway-tool-access-control

WHAT THIS VERIFIES
------------------
A single deny Authorization_Decision produces EXACTLY ONE structured audit
record in the dedicated deny-audit CloudWatch Log Group, carrying the four
required fields and nothing sensitive (Req 8.3):

  * the record contains the four fields ``identityRef``, ``category``,
    ``outcome`` and ``timestamp`` (and no others are required),
  * ``outcome`` equals ``"deny"``,
  * ``category`` matches the denied tool category that was invoked,
  * ``identityRef`` references the caller's identity (the JWT ``sub``), and
  * the record does NOT contain the raw bearer token.

The deny-audit interceptor (GatewayStack, design.md "Components and Interfaces"
section 4) emits exactly one structured CloudWatch record on a deny decision —
the JWT ``sub``, the requested category, the ``deny`` outcome, and a timestamp —
and never logs token values or tool arguments/results.

This is an END-TO-END test against the *live deployed* Gateway + Policy engine +
deny-audit interceptor, using a real Cognito-issued NON-ADMIN access token. It
cannot run without deployed infrastructure, a valid non-admin token, and the
name of the deny-audit Log Group, so it AUTO-SKIPS when the required environment
variables (below) are absent. When skipped the file still collects cleanly,
keeping the suite green in CI without infra.

REQUIRED ENVIRONMENT VARIABLES
------------------------------
The test runs only when ALL of the following are set; otherwise it SKIPS.

  INTEGRATION_TEST_ENABLED
      Master switch. Must be set to a truthy value ("1", "true", "yes", "on")
      to opt in to live integration testing.

  GATEWAY_URL   (or)   GATEWAY_ARN
      The deployed Gateway MCP endpoint. Provide either the full MCP URL via
      GATEWAY_URL (e.g. "https://<gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp")
      or GATEWAY_ARN, from which the endpoint URL is derived (the region is
      taken from AWS_REGION / AWS_DEFAULT_REGION).

  NONADMIN_ACCESS_TOKEN
      A valid Cognito access token (JWT) for a user who is NOT in the
      ``Administrators`` group — i.e. a token carrying role claim "nonadmin"
      (or no/unknown role, which the Gateway treats as NonAdmin). The token is
      forwarded unmodified as ``Authorization: Bearer <token>``. Its ``sub``
      claim is used to correlate the emitted audit record to this invocation.

  DENY_AUDIT_LOG_GROUP
      The name of the dedicated CloudWatch Log Group the deny-audit interceptor
      writes to (e.g. "/cloudops/gateway/deny-audit"). The test queries this
      group via the boto3 ``logs`` client for the record produced by the denied
      invocation.

OPTIONAL ENVIRONMENT VARIABLES
------------------------------
  DENIED_TOOL_NAME
      A specific denied tool name to invoke (e.g.
      "cloudwatchMcp___get_metric_data"). If unset, the test attempts a set of
      well-known denied tool-name candidates across the cloudwatch / cloudtrail
      / inventory categories.

  AWS_REGION / AWS_DEFAULT_REGION
      Region used to derive the endpoint from GATEWAY_ARN and to construct the
      CloudWatch Logs client. Defaults to "us-east-1" when neither is set and
      GATEWAY_URL is not provided.

  INTEGRATION_TEST_TIMEOUT
      Per-call timeout in seconds for the Gateway invocation (default 30).

  DENY_AUDIT_POLL_SECONDS
      Maximum seconds to poll CloudWatch Logs for the audit record, allowing for
      log-propagation delay (default 60).

  DENY_AUDIT_POLL_INTERVAL
      Seconds between CloudWatch Logs polls (default 3).

Validates: Requirements 8.3
"""

from __future__ import annotations

import asyncio
import base64
import json
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


def _is_truthy(value) -> bool:
    return bool(value) and str(value).strip().lower() in _TRUTHY


def _resolve_region() -> str:
    return (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    )


def _derive_gateway_url() -> str | None:
    """Resolve the Gateway MCP endpoint from GATEWAY_URL or GATEWAY_ARN."""
    url = os.environ.get("GATEWAY_URL")
    if url:
        return url
    arn = os.environ.get("GATEWAY_ARN")
    if not arn:
        return None
    gateway_id = arn.split("/")[-1]
    region = _resolve_region()
    return (
        f"https://{gateway_id}.gateway.bedrock-agentcore.{region}.amazonaws.com/mcp"
    )


def _missing_requirements() -> list[str]:
    """Return the list of unmet preconditions; empty list means ready to run."""
    missing: list[str] = []
    if not _is_truthy(os.environ.get("INTEGRATION_TEST_ENABLED")):
        missing.append("INTEGRATION_TEST_ENABLED (set to 1/true to enable)")
    if not _derive_gateway_url():
        missing.append("GATEWAY_URL or GATEWAY_ARN")
    if not os.environ.get("NONADMIN_ACCESS_TOKEN"):
        missing.append("NONADMIN_ACCESS_TOKEN (Cognito non-admin JWT)")
    if not os.environ.get("DENY_AUDIT_LOG_GROUP"):
        missing.append("DENY_AUDIT_LOG_GROUP (deny-audit CloudWatch Log Group name)")
    return missing


# Evaluated at import/collection time so the whole module skips cleanly when the
# deployed infrastructure is not configured.
_MISSING = _missing_requirements()

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        bool(_MISSING),
        reason=(
            "Live Gateway + deny-audit interceptor integration test; "
            "missing required configuration: " + ", ".join(_MISSING)
        ),
    ),
]


# Well-known denied tool-name candidates spanning the three Non-Admin-denied
# categories. The test invokes the first candidate that the Gateway recognizes
# enough to evaluate against policy; every one of these must be DENIED for a
# Non-Admin caller. A single explicit override may be supplied via
# DENIED_TOOL_NAME.
_DENIED_TOOL_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("cloudwatch", "cloudwatchMcp___get_metric_data"),
    ("cloudwatch", "cloudwatchMcp___describe_log_groups"),
    ("cloudtrail", "cloudtrailMcp___lookup_events"),
    ("inventory", "inventoryMcp___list_clusters"),
)


def _candidate_tools() -> tuple[tuple[str, str], ...]:
    """Return (category, tool_name) candidates, honoring DENIED_TOOL_NAME."""
    override = os.environ.get("DENIED_TOOL_NAME")
    if override:
        from authorization_model import extract_denied_category

        category = extract_denied_category(override) or "cloudwatch"
        return ((category, override),)
    return _DENIED_TOOL_CANDIDATES


# ---------------------------------------------------------------------------
# JWT helper (identity correlation)
# ---------------------------------------------------------------------------

def _decode_jwt_claims(token: str) -> dict:
    """Decode a JWT's payload (claims) WITHOUT verifying the signature.

    Only the ``sub`` claim is needed to correlate the emitted audit record to
    this caller; the token's authenticity is already guaranteed by Cognito
    having issued it and by the Gateway independently verifying it.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    payload_b64 = parts[1]
    padding = "=" * (-len(payload_b64) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload_b64 + padding)
        return json.loads(decoded)
    except Exception:  # noqa: BLE001 - best-effort decode
        return {}


# ---------------------------------------------------------------------------
# Live invocation helper (mirrors the Task 9.5 denial test)
# ---------------------------------------------------------------------------

async def _invoke_denied_tool(url: str, token: str, tool_name: str, timeout: float):
    """Attempt a ``tools/call`` of ``tool_name`` and return (outcome, detail).

    Returns one of:
      ("denied", error_text)  — the Gateway raised an authorization error.
      ("result", result_obj)  — the call returned a result (UNEXPECTED for a
                                 denied category).
      ("error", repr)         — an unrelated failure (e.g. unknown tool name).

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
                if getattr(result, "isError", False) and is_authorization_denial(
                    _result_text(result)
                ):
                    return "denied", _result_text(result)
                return "result", result
    except Exception as exc:  # noqa: BLE001 - we classify below
        return "denied" if is_authorization_denial(exc) else "error", repr(exc)


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


def _trigger_one_denied_invocation(url: str, token: str, timeout: float):
    """Drive exactly one denied-category invocation; return (category, tool_name).

    Tries the candidate tools in order and returns the first one the Gateway
    actually evaluated to a DENY. ``pytest.fail`` if none could be evaluated and
    ``pytest.fail`` if a candidate unexpectedly returned a result (that would be
    a policy bug, surfaced loudly).
    """
    last_detail = None
    for category, tool_name in _candidate_tools():
        outcome, detail = asyncio.run(
            _invoke_denied_tool(url, token, tool_name, timeout)
        )
        last_detail = (tool_name, outcome, detail)
        if outcome == "error":
            # Not an authorization error (e.g. the tool name is not present at
            # all for this deployment). Try the next candidate.
            continue
        assert outcome != "result", (
            f"Non-Admin invocation of denied tool '{tool_name}' ({category}) "
            "unexpectedly returned a result; a deny was expected so that the "
            "interceptor would emit an audit record (Req 8.3)."
        )
        # outcome == "denied": a deny decision was produced for this category.
        return category, tool_name

    pytest.fail(
        "No denied-category tool could be evaluated against the deployed "
        "Gateway policy, so no deny-audit record could be produced. Set "
        "DENIED_TOOL_NAME to a known cloudwatch/cloudtrail/inventory tool for "
        f"this deployment. Last attempt: {last_detail!r}"
    )


# ---------------------------------------------------------------------------
# CloudWatch Logs query helpers
# ---------------------------------------------------------------------------

def _extract_audit_records(message: str) -> list[dict]:
    """Parse zero or more structured deny-audit JSON objects from a log message.

    A single CloudWatch log event's ``message`` normally carries one JSON
    object, but defensively we also handle a message that embeds JSON within
    surrounding text. Returns the list of dicts that look like a deny-audit
    record (i.e. carry an ``outcome`` field).
    """
    records: list[dict] = []
    text = message.strip()

    # Fast path: the whole message is a JSON object.
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return [obj]
    except (ValueError, TypeError):
        pass

    # Fallback: find embedded JSON objects by brace scanning.
    depth = 0
    start = None
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    chunk = text[start : i + 1]
                    try:
                        obj = json.loads(chunk)
                        if isinstance(obj, dict):
                            records.append(obj)
                    except (ValueError, TypeError):
                        pass
                    start = None
    return records


def _normalize_record(record: dict) -> dict:
    """Map a record's field names to the canonical audit field names.

    Accepts either the design's camelCase field names (``identityRef``,
    ``category``, ``outcome``, ``timestamp``) or the dataclass snake_case
    equivalents, so the assertion is robust to minor serialization differences.
    """
    def pick(*names):
        for name in names:
            if name in record and record[name] is not None:
                return record[name]
        return None

    return {
        "identityRef": pick("identityRef", "identity_ref"),
        "category": pick("category"),
        "outcome": pick("outcome"),
        "timestamp": pick("timestamp"),
    }


def _is_deny_audit_for_identity(record: dict, identity_ref: str | None) -> bool:
    """Return whether ``record`` is a deny-audit entry for this caller.

    A matching record has ``outcome == "deny"`` and, when an ``identity_ref`` is
    known, an ``identityRef`` equal to it (the JWT ``sub``) so concurrent or
    historical records for other users are excluded.
    """
    norm = _normalize_record(record)
    if norm["outcome"] != "deny":
        return False
    if identity_ref:
        return norm["identityRef"] == identity_ref
    return True


def _collect_matching_records(
    logs_client,
    log_group: str,
    start_time_ms: int,
    identity_ref: str | None,
) -> list[dict]:
    """Page through ``filter_log_events`` and return matching deny-audit records.

    Scans all events in ``log_group`` at or after ``start_time_ms`` and returns
    the structured deny-audit records that correspond to this caller's denied
    invocation. Each returned tuple is ``(normalized_record, raw_message)`` so
    the caller can assert both the structured fields and the absence of the raw
    token in the underlying log line.
    """
    matches: list[dict] = []
    next_token = None
    while True:
        kwargs = {
            "logGroupName": log_group,
            "startTime": start_time_ms,
            "limit": 1000,
        }
        if next_token:
            kwargs["nextToken"] = next_token
        response = logs_client.filter_log_events(**kwargs)
        for event in response.get("events", []):
            message = event.get("message", "")
            for record in _extract_audit_records(message):
                if _is_deny_audit_for_identity(record, identity_ref):
                    matches.append({"record": record, "message": message})
        next_token = response.get("nextToken")
        if not next_token:
            break
    return matches


def _poll_for_records(
    logs_client,
    log_group: str,
    start_time_ms: int,
    identity_ref: str | None,
    poll_seconds: float,
    poll_interval: float,
) -> list[dict]:
    """Poll CloudWatch Logs until at least one matching record appears or timeout.

    Allows for log-propagation delay between the deny decision and the record
    becoming queryable. Returns whatever matches are present after a match is
    first seen (plus a short settle poll) or when the poll window elapses.
    """
    deadline = time.monotonic() + poll_seconds
    matches: list[dict] = []
    while time.monotonic() < deadline:
        matches = _collect_matching_records(
            logs_client, log_group, start_time_ms, identity_ref
        )
        if matches:
            # Give a brief settle window so a duplicate emission (which would be
            # a bug we WANT to catch) has a chance to land before we assert the
            # count is exactly one.
            time.sleep(poll_interval)
            matches = _collect_matching_records(
                logs_client, log_group, start_time_ms, identity_ref
            )
            return matches
        time.sleep(poll_interval)
    return matches


# ---------------------------------------------------------------------------
# The test
# ---------------------------------------------------------------------------

def test_deny_decision_produces_exactly_one_audit_record_with_four_fields():
    """A deny decision emits exactly one four-field deny-audit record (Req 8.3).

    End-to-end:
      1. As a NON-ADMIN user, invoke a denied-category tool through the Gateway
         (expecting a deny from the Cedar Policy engine).
      2. Query the dedicated deny-audit CloudWatch Log Group for records emitted
         around the test time and correlated to this caller's JWT ``sub``.
      3. Assert EXACTLY ONE structured deny-audit record corresponds to the
         invocation, carrying the four required fields
         {identityRef, category, outcome:"deny", timestamp}, with the category
         matching the denied category and outcome == "deny", and that the record
         (and its raw log line) does NOT contain the raw bearer token.
    """
    boto3 = pytest.importorskip("boto3", reason="boto3 is required for the live test")

    url = _derive_gateway_url()
    token = os.environ["NONADMIN_ACCESS_TOKEN"]
    log_group = os.environ["DENY_AUDIT_LOG_GROUP"]
    timeout = float(os.environ.get("INTEGRATION_TEST_TIMEOUT", "30"))
    poll_seconds = float(os.environ.get("DENY_AUDIT_POLL_SECONDS", "60"))
    poll_interval = float(os.environ.get("DENY_AUDIT_POLL_INTERVAL", "3"))

    # Correlate the audit record to this caller via the token's ``sub`` claim.
    claims = _decode_jwt_claims(token)
    identity_ref = claims.get("sub")

    # Mark the query window just before the invocation (1s of slack for clock
    # skew) so we only consider records this test could have produced.
    start_time_ms = int((time.time() - 1) * 1000)

    # (1) Trigger exactly one denied-category invocation.
    denied_category, tool_name = _trigger_one_denied_invocation(url, token, timeout)

    # (2) Query the deny-audit Log Group, polling for propagation.
    logs_client = boto3.client("logs", region_name=_resolve_region())
    matches = _poll_for_records(
        logs_client,
        log_group,
        start_time_ms,
        identity_ref,
        poll_seconds,
        poll_interval,
    )

    # (3a) Exactly one audit record for this denied invocation.
    assert len(matches) == 1, (
        f"Expected exactly ONE deny-audit record for identity {identity_ref!r} "
        f"after denying '{tool_name}' ({denied_category}); found {len(matches)}. "
        f"Records: {[m['record'] for m in matches]!r} (Req 8.3)."
    )

    record = matches[0]["record"]
    raw_message = matches[0]["message"]
    norm = _normalize_record(record)

    # (3b) The four required fields are present and non-empty.
    for field in ("identityRef", "category", "outcome", "timestamp"):
        assert norm[field] not in (None, ""), (
            f"Deny-audit record is missing required field '{field}'. "
            f"Record: {record!r} (Req 8.3)."
        )

    # (3c) Field values are correct: deny outcome, matching category, and the
    # identity reference equals the caller's JWT sub (when known).
    assert norm["outcome"] == "deny", (
        f"Deny-audit record outcome must be 'deny'; got {norm['outcome']!r}."
    )
    assert norm["category"] == denied_category, (
        f"Deny-audit record category {norm['category']!r} must match the denied "
        f"category {denied_category!r} (Req 8.3)."
    )
    if identity_ref:
        assert norm["identityRef"] == identity_ref, (
            f"Deny-audit identityRef {norm['identityRef']!r} must reference the "
            f"caller's JWT sub {identity_ref!r} (Req 8.3)."
        )

    # (3d) The record must NOT leak the raw bearer token, in either the parsed
    # record or the underlying raw log line.
    assert token not in json.dumps(record), (
        "Deny-audit record must not contain the raw bearer token (Req 8.3)."
    )
    assert token not in raw_message, (
        "Deny-audit log line must not contain the raw bearer token (Req 8.3)."
    )
