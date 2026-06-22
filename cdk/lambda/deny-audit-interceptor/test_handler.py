"""Example-based unit tests for the deny-audit REQUEST interceptor (Task 4.4).

Feature: gateway-tool-access-control

These are deterministic, example-based unit tests (pytest) for
``handler.handler`` in this directory. They verify the two behaviors the task
calls out:

  - A computed deny (e.g. a NonAdmin user invoking a denied-category tool)
    produces EXACTLY ONE structured CloudWatch log record carrying ONLY the four
    mandated fields ``{identityRef, category, outcome, timestamp}`` -- with the
    JWT ``sub`` as ``identityRef``, the requested category, and ``outcome ==
    "deny"`` -- and never the raw token or ``Authorization`` header (Req 8.3).
  - The audit-failure path still returns the unchanged pass-through response and
    never raises, so an audit failure cannot suppress the authoritative
    authorization error produced independently by Cedar Policy (Req 8.4).

Allowed decisions and non-invocation methods (e.g. ``tools/list`` discovery)
emit no audit record at all.

Validates: Requirements 8.3, 8.4
"""

from __future__ import annotations

import base64
import json
import os
import sys
from typing import Any, Dict, List, Optional

# Make the handler and its vendored ``authorization_model`` importable when the
# test is run from an arbitrary working directory. The modules under test sit in
# this same directory (the handler imports ``from authorization_model import``).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import handler  # noqa: E402
from handler import TOOLS_CALL_METHOD  # noqa: E402


# ---------------------------------------------------------------------------
# Test helpers: JWT construction + interceptor event builders
# ---------------------------------------------------------------------------

def _b64url(raw: bytes) -> str:
    """base64url-encode ``raw`` without padding (matching JWT segment encoding)."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _make_jwt(*, sub: str, role: Optional[str]) -> str:
    """Build an unsigned ``header.payload.signature`` JWT for testing.

    The handler decodes (without verifying) only the payload segment to read the
    ``sub`` and ``role`` claims, so the header/signature contents are arbitrary.
    """
    header = _b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode("utf-8"))
    payload: Dict[str, Any] = {"sub": sub}
    if role is not None:
        payload["role"] = role
    body = _b64url(json.dumps(payload).encode("utf-8"))
    return f"{header}.{body}.signature"


def _make_event(
    *,
    method: str = TOOLS_CALL_METHOD,
    tool_name: Optional[str] = "cloudwatchMcp___get_metric_data",
    authorization: Optional[str] = None,
    arguments: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a REQUEST-interceptor event matching the handler's expected shape.

    ``event.mcp.gatewayRequest`` carries the (optional) headers and the JSON-RPC
    ``body`` (``{method, params:{name, arguments}}``).
    """
    params: Dict[str, Any] = {}
    if tool_name is not None:
        params["name"] = tool_name
    if arguments is not None:
        params["arguments"] = arguments

    gateway_request: Dict[str, Any] = {
        "body": {"method": method, "params": params},
    }
    if authorization is not None:
        gateway_request["headers"] = {"Authorization": authorization}

    return {"mcp": {"gatewayRequest": gateway_request}}


class _LogRecorder:
    """A minimal stand-in for the module logger that records emitted records.

    Replacing ``handler.logger`` makes "exactly one structured record" assertions
    deterministic without depending on root-logger propagation/levels.
    """

    def __init__(self) -> None:
        self.info_records: List[str] = []
        self.warnings: List[str] = []

    def info(self, msg: Any, *args: Any, **kwargs: Any) -> None:
        self.info_records.append(msg)

    def warning(self, msg: Any, *args: Any, **kwargs: Any) -> None:
        self.warnings.append(msg)

    def setLevel(self, *args: Any, **kwargs: Any) -> None:  # noqa: N802 - logger API
        pass


def _expected_passthrough(event: Dict[str, Any]) -> Dict[str, Any]:
    """The pass-through output the handler must always return for ``event``."""
    body = event["mcp"]["gatewayRequest"]["body"]
    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {"transformedGatewayRequest": {"body": body}},
    }


# ---------------------------------------------------------------------------
# Req 8.3: a deny decision produces exactly one four-field audit record
# ---------------------------------------------------------------------------

def test_deny_emits_exactly_one_four_field_audit_record(monkeypatch):
    """NonAdmin invoking a cloudwatch tool -> one record with the four fields."""
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="user-123", role="nonadmin")
    event = _make_event(
        tool_name="cloudwatchMcp___get_metric_data",
        authorization=f"Bearer {token}",
        arguments={"namespace": "AWS/EC2", "metricName": "CPUUtilization"},
    )

    result = handler.handler(event, None)

    # Exactly one structured record was emitted.
    assert len(recorder.info_records) == 1
    record = json.loads(recorder.info_records[0])

    # Keys are EXACTLY the four mandated fields -- nothing else.
    assert set(record.keys()) == {"identityRef", "category", "outcome", "timestamp"}
    assert record["identityRef"] == "user-123"
    assert record["category"] == "cloudwatch"
    assert record["outcome"] == "deny"
    assert isinstance(record["timestamp"], str) and record["timestamp"]

    # The token / Authorization header must NOT appear anywhere in the record.
    raw = recorder.info_records[0]
    assert token not in raw
    assert "Bearer" not in raw
    assert "authorization" not in raw.lower()

    # The handler still forwards the request unchanged.
    assert result == _expected_passthrough(event)


def test_deny_for_cloudtrail_records_that_category(monkeypatch):
    """A NonAdmin cloudtrail invocation audits the cloudtrail category."""
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="abc-789", role="nonadmin")
    event = _make_event(
        tool_name="cloudtrailMcp___lookup_events",
        authorization=f"Bearer {token}",
    )

    handler.handler(event, None)

    assert len(recorder.info_records) == 1
    record = json.loads(recorder.info_records[0])
    assert record["category"] == "cloudtrail"
    assert record["identityRef"] == "abc-789"
    assert record["outcome"] == "deny"


def test_deny_with_missing_role_claim_defaults_nonadmin(monkeypatch):
    """An absent role claim resolves to NonAdmin, so cloudwatch is a deny."""
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="no-role-user", role=None)
    event = _make_event(
        tool_name="inventoryMcp___list_resources",
        authorization=f"Bearer {token}",
    )

    handler.handler(event, None)

    assert len(recorder.info_records) == 1
    record = json.loads(recorder.info_records[0])
    assert record["identityRef"] == "no-role-user"
    assert record["category"] == "inventory"
    assert record["outcome"] == "deny"


# ---------------------------------------------------------------------------
# Allowed decisions emit NO audit record
# ---------------------------------------------------------------------------

def test_admin_invoking_cloudwatch_emits_no_record(monkeypatch):
    """An Admin is allowed cloudwatch, so no deny-audit record is emitted."""
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="admin-1", role="admin")
    event = _make_event(
        tool_name="cloudwatchMcp___get_metric_data",
        authorization=f"Bearer {token}",
    )

    result = handler.handler(event, None)

    assert recorder.info_records == []
    assert result == _expected_passthrough(event)


def test_nonadmin_invoking_billing_emits_no_record(monkeypatch):
    """billing is allowed for every role, so no record is emitted."""
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="user-456", role="nonadmin")
    event = _make_event(
        tool_name="billingMcp___get_cost_and_usage",
        authorization=f"Bearer {token}",
    )

    result = handler.handler(event, None)

    assert recorder.info_records == []
    assert result == _expected_passthrough(event)


def test_nonadmin_invoking_pricing_emits_no_record(monkeypatch):
    """pricing is allowed for every role, so no record is emitted."""
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="user-456", role="nonadmin")
    event = _make_event(
        tool_name="pricingMcp___get_products",
        authorization=f"Bearer {token}",
    )

    handler.handler(event, None)

    assert recorder.info_records == []


# ---------------------------------------------------------------------------
# Discovery / non-invocation methods produce no audit record
# ---------------------------------------------------------------------------

def test_tools_list_discovery_emits_no_record(monkeypatch):
    """``tools/list`` discovery is not a Tool_Invocation -> no deny-audit record."""
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="user-789", role="nonadmin")
    event = _make_event(
        method="tools/list",
        tool_name=None,
        authorization=f"Bearer {token}",
    )

    result = handler.handler(event, None)

    assert recorder.info_records == []
    assert result == _expected_passthrough(event)


def test_other_method_emits_no_record(monkeypatch):
    """A non ``tools/call`` method (e.g. ``ping``) emits no record."""
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="user-789", role="nonadmin")
    event = _make_event(
        method="ping",
        tool_name=None,
        authorization=f"Bearer {token}",
    )

    handler.handler(event, None)

    assert recorder.info_records == []


# ---------------------------------------------------------------------------
# Req 8.4: an audit-step failure must NOT suppress / alter the pass-through
# ---------------------------------------------------------------------------

def test_audit_failure_still_returns_unchanged_passthrough(monkeypatch):
    """If the audit step raises, the handler still forwards the request unchanged.

    This demonstrates that an audit-record failure cannot suppress the
    authoritative authorization error (produced independently by Cedar Policy)
    -- the interceptor never alters its pass-through output.
    """
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    def _boom(*args, **kwargs):
        raise RuntimeError("audit backend unavailable")

    # Force the audit step to fail at entry construction.
    monkeypatch.setattr(handler, "build_deny_audit_entry", _boom)

    token = _make_jwt(sub="user-123", role="nonadmin")
    event = _make_event(
        tool_name="cloudwatchMcp___get_metric_data",
        authorization=f"Bearer {token}",
    )

    # Must NOT raise.
    result = handler.handler(event, None)

    # No structured audit record was emitted, but the request is forwarded
    # unchanged and the failure was swallowed (logged as a warning).
    assert recorder.info_records == []
    assert result == _expected_passthrough(event)
    assert len(recorder.warnings) == 1


def test_audit_failure_on_logging_still_returns_passthrough(monkeypatch):
    """A failure inside ``logger.info`` is swallowed; pass-through is unchanged."""

    class _ExplodingLogger(_LogRecorder):
        def info(self, msg: Any, *args: Any, **kwargs: Any) -> None:
            raise RuntimeError("cloudwatch put failed")

    recorder = _ExplodingLogger()
    monkeypatch.setattr(handler, "logger", recorder)

    token = _make_jwt(sub="user-123", role="nonadmin")
    event = _make_event(
        tool_name="cloudwatchMcp___get_metric_data",
        authorization=f"Bearer {token}",
    )

    result = handler.handler(event, None)

    assert result == _expected_passthrough(event)
    assert len(recorder.warnings) == 1


def test_missing_authorization_header_does_not_raise(monkeypatch):
    """With no Authorization header the identity is unknown; deny still audited.

    A missing/garbled header must never cause the interceptor to raise; the
    request is always forwarded unchanged.
    """
    recorder = _LogRecorder()
    monkeypatch.setattr(handler, "logger", recorder)

    event = _make_event(
        tool_name="cloudwatchMcp___get_metric_data",
        authorization=None,
    )

    result = handler.handler(event, None)

    # No resolvable identity -> NonAdmin -> cloudwatch is a deny, audited with
    # the placeholder identity reference (never any token material).
    assert len(recorder.info_records) == 1
    record = json.loads(recorder.info_records[0])
    assert record["identityRef"] == "unknown"
    assert record["category"] == "cloudwatch"
    assert result == _expected_passthrough(event)
