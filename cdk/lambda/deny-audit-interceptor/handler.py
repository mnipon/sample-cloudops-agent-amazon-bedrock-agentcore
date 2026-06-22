"""
Deny-audit REQUEST interceptor for the AgentCore Gateway.

PURPOSE (Req 8.3, 8.4)
----------------------
Emit EXACTLY ONE structured CloudWatch log record whenever a Tool_Invocation
(``tools/call``) would be denied for the calling user's role, containing the
four mandated fields and nothing else:

    { "identityRef": <JWT sub>, "category": <Tool_Category>,
      "outcome": "deny", "timestamp": <ISO-8601> }

It NEVER logs token values, tool input arguments, tool output, or tool results.

ROLE IN THE ARCHITECTURE -- AUDIT ONLY, PASS-THROUGH
----------------------------------------------------
The authoritative authorization layer is the Gateway's AgentCore (Cedar) Policy
engine (configured in ``gateway-stack.ts``, task 4.2). That engine is what
actually denies discovery/invocation and returns the ``AuthorizeActionException``
to the caller. This interceptor does NOT enforce: it inspects the request,
independently re-derives the authorization decision using the SAME authoritative
role -> category model (``authorization_model.py``, the property-tested surface),
emits the structured audit record on a computed deny, and then ALWAYS passes the
request through unchanged. Cedar Policy then produces the authoritative deny.

WHY THIS GUARANTEES Req 8.4 (audit failure must not suppress the error)
-----------------------------------------------------------------------
The entire audit step is wrapped so that ANY failure (a missing/garbled
``Authorization`` header, an undecodable token, a logging error, etc.) is
swallowed and the request is still passed through UNCHANGED. Because the
authoritative deny is produced by Cedar Policy independently of this interceptor,
an audit-record failure can never suppress or alter the authorization error
returned to the caller. The interceptor never returns a ``transformedGatewayResponse``,
so it cannot short-circuit or mutate the authoritative decision.

IDENTITY / TOKEN HANDLING (security)
------------------------------------
The JWT ``sub`` and ``role`` claim are only available to the interceptor via the
inbound ``Authorization`` header, which is delivered only when the gateway
interceptor is configured with ``passRequestHeaders: true``. The Gateway has
ALREADY verified the JWT (issuer, client_id via AllowedClients, signature)
before this interceptor runs -- the forwarded Cognito access token carries
``client_id`` and no ``aud`` claim -- so this handler only base64-decodes the
JWT payload to read the ``sub``
and ``role`` claims -- it performs no signature verification and, critically,
NEVER logs the raw token or the ``Authorization`` header. Only the four audit
fields are ever logged.

INTERCEPTOR CONTRACT (MCP target REQUEST interceptor)
-----------------------------------------------------
Input  : event["mcp"]["gatewayRequest"] = { headers?, body: {method, params:{name, arguments}} }
Output : { "interceptorOutputVersion": "1.0",
           "mcp": { "transformedGatewayRequest": { "body": <original body> } } }

See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-interceptors-types.html

Feature: gateway-tool-access-control
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from authorization_model import (
    _CATEGORY_TARGET_PREFIXES,
    Decision,
    Role,
    authorize,
    build_deny_audit_entry,
    derive_role,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# The MCP method that performs a Tool_Invocation. Discovery (``tools/list``,
# including semantic search) is filtered by the Cedar meta-action, not audited
# here, so only invocations are considered for deny-audit records.
TOOLS_CALL_METHOD: str = "tools/call"

# Separator between the Gateway target name and the upstream tool name in a
# fully-qualified gateway tool action (e.g. ``cloudwatchMcp___get_metric_data``).
TOOL_NAME_SEPARATOR: str = "___"

# The verified scalar role claim injected by the Cognito Pre Token Generation
# Lambda (see auth-stack.ts / cdk/lambda/pre-token-generation).
ROLE_CLAIM_NAME: str = "role"

# Identity reference used when no resolvable identity is present on the request
# (Req 7.4 treats a missing identity as NonAdmin; the audit still records the
# deny with this placeholder reference rather than any token material).
UNKNOWN_IDENTITY_REF: str = "unknown"


def _passthrough(request_body: Any) -> Dict[str, Any]:
    """Return the REQUEST-interceptor output that forwards the request unchanged.

    The interceptor never alters the request and never returns a
    ``transformedGatewayResponse``, so the authoritative Cedar Policy decision
    is preserved in all cases.
    """
    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {"transformedGatewayRequest": {"body": request_body}},
    }


def _decode_jwt_claims(authorization_value: str) -> Dict[str, Any]:
    """Decode (without verifying) the JWT payload from an ``Authorization`` value.

    The Gateway has already verified the token before invoking this interceptor;
    here we only need the ``sub`` and ``role`` claims. Returns an empty dict on
    any malformed input. NEVER logs the token or any decode error text (which
    could echo token material).

    Args:
        authorization_value: The raw ``Authorization`` header value, optionally
            prefixed with ``"Bearer "``.

    Returns:
        The decoded JWT claims as a dict, or ``{}`` if the value cannot be
        decoded.
    """
    if not isinstance(authorization_value, str) or not authorization_value:
        return {}

    token = authorization_value.strip()
    if token.lower().startswith("bearer "):
        token = token[len("bearer "):].strip()

    parts = token.split(".")
    if len(parts) < 2:
        return {}

    payload_segment = parts[1]
    # Restore base64url padding that JWT encoding strips.
    padding = "=" * (-len(payload_segment) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload_segment + padding)
        claims = json.loads(decoded)
    except (binascii.Error, ValueError, TypeError):
        # Malformed token payload. Do not log -- the offending text could
        # contain token material.
        return {}

    return claims if isinstance(claims, dict) else {}


def _extract_authorization(gateway_request: Dict[str, Any]) -> Optional[str]:
    """Read the ``Authorization`` header value, tolerant of header casing.

    Returns ``None`` when headers are absent (e.g. ``passRequestHeaders`` is
    false) or no authorization header is present.
    """
    headers = gateway_request.get("headers")
    if not isinstance(headers, dict):
        return None
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == "authorization":
            return value if isinstance(value, str) else None
    return None


def _resolve_identity(gateway_request: Dict[str, Any]) -> tuple[Role, str]:
    """Resolve the caller's Role and identity reference from the request.

    Decodes the verified JWT (best-effort) to read the ``role`` and ``sub``
    claims. A missing/garbled token resolves to ``Role.NonAdmin`` and the
    ``UNKNOWN_IDENTITY_REF`` placeholder (Req 7.4). The raw token is never
    logged or returned.
    """
    authorization = _extract_authorization(gateway_request)
    claims = _decode_jwt_claims(authorization) if authorization else {}
    role = derive_role(claims.get(ROLE_CLAIM_NAME))
    sub = claims.get("sub")
    identity_ref = sub if isinstance(sub, str) and sub else UNKNOWN_IDENTITY_REF
    return role, identity_ref


def _category_from_tool_name(tool_name: Any) -> Optional[str]:
    """Map a fully-qualified gateway tool name to its Tool_Category identifier.

    ``<targetName>___<toolName>`` -> the category backing that target
    (``billingMcp___...`` -> ``"billing"``). For an unrecognized target prefix
    the target prefix itself is returned (so the request is still treated as an
    unknown category and audited as a default-deny). Returns ``None`` only when
    no target prefix can be determined (no separator), in which case there is
    nothing meaningful to audit.
    """
    if not isinstance(tool_name, str) or TOOL_NAME_SEPARATOR not in tool_name:
        return None
    prefix = tool_name.split(TOOL_NAME_SEPARATOR, 1)[0]
    known = _CATEGORY_TARGET_PREFIXES.get(prefix.lower())
    if known is not None:
        return known.value
    # Unknown target prefix -> surface it as the (unknown) category so the
    # default-deny path records a meaningful identifier.
    return prefix


def _audit_if_deny(gateway_request: Dict[str, Any], request_body: Any) -> None:
    """Emit one structured deny-audit record iff this invocation is a deny.

    Only ``tools/call`` invocations are considered. The decision is computed
    independently using the authoritative role -> category model; on a deny a
    single structured record (the four mandated fields) is logged. No tool
    arguments/results are ever read for logging -- only the tool name (to
    determine the category) and the verified identity claims are used.
    """
    if not isinstance(request_body, dict):
        return
    if request_body.get("method") != TOOLS_CALL_METHOD:
        return

    params = request_body.get("params")
    tool_name = params.get("name") if isinstance(params, dict) else None
    category = _category_from_tool_name(tool_name)
    if category is None:
        # Cannot classify a category -> nothing meaningful to audit. Cedar
        # Policy still authorizes the request authoritatively.
        return

    role, identity_ref = _resolve_identity(gateway_request)
    if authorize(role, category) != Decision.Deny:
        # Allowed for this role -> no deny-audit record.
        return

    entry = build_deny_audit_entry(
        identity_ref=identity_ref,
        category=category,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
    # Exactly ONE structured CloudWatch record per deny decision (Req 8.3).
    logger.info(json.dumps(entry.to_dict()))


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Gateway REQUEST interceptor entry point.

    Best-effort emits a deny-audit record, then ALWAYS forwards the request
    unchanged so the Gateway's Cedar Policy remains the authoritative authorizer
    and any audit failure cannot suppress the authorization error (Req 8.4).
    """
    mcp_data = event.get("mcp") if isinstance(event, dict) else None
    mcp_data = mcp_data if isinstance(mcp_data, dict) else {}
    gateway_request = mcp_data.get("gatewayRequest")
    gateway_request = gateway_request if isinstance(gateway_request, dict) else {}
    request_body = gateway_request.get("body")

    try:
        _audit_if_deny(gateway_request, request_body)
    except Exception:  # noqa: BLE001 - audit is strictly best-effort
        # Swallow ALL audit errors. Never include exception text (it could echo
        # token material), and never let a failure change the pass-through
        # result, so the authoritative authorization error is preserved (Req 8.4).
        logger.warning(
            "deny-audit interceptor: audit step failed; forwarding request unchanged"
        )

    return _passthrough(request_body)
