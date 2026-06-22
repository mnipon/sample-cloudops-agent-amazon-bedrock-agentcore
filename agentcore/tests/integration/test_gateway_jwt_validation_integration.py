"""Integration test: CUSTOM_JWT Gateway validates Cognito tokens (Task 9.2).

Feature: gateway-tool-access-control

This integration test exercises the LIVE, deployed AgentCore Gateway whose
inbound authorizer is configured as ``CUSTOM_JWT`` (a Cognito User Pool issuer).
It verifies Requirement 1.5 at the transport boundary:

  * a VALID Cognito access token is accepted by the Gateway (an MCP
    ``tools/list`` succeeds), and
  * an INVALID / expired / garbage token is REJECTED by the Gateway before any
    policy evaluation (the MCP call fails / raises an auth error).

Because this test talks to deployed infrastructure it CANNOT run in a plain unit
environment. It therefore AUTO-SKIPS unless the required environment variables
are present, and is safe to collect (it never requires live infra merely to be
imported or collected).

--------------------------------------------------------------------------------
Required environment variables (all must be set to ENABLE the test):
--------------------------------------------------------------------------------
  INTEGRATION_TEST_ENABLED
      Master switch. Set to a truthy value ("1", "true", "yes", "on") to opt in.

  Gateway endpoint (one of):
      GATEWAY_URL   Full MCP endpoint URL, e.g.
                    https://<gatewayId>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp
      GATEWAY_ARN   Gateway ARN; the MCP endpoint is derived from it (requires
                    AWS_REGION or a default boto3 region to be resolvable).

  A valid Cognito access token (one of):
      COGNITO_ACCESS_TOKEN
          A pre-fetched, currently-valid Cognito access token to present as the
          VALID case. Simplest option for CI.
      -- OR provide credentials so the test can mint one via USER_PASSWORD_AUTH:
      COGNITO_CLIENT_ID   App client id (no secret, USER_PASSWORD_AUTH enabled)
      COGNITO_USERNAME    User to authenticate
      COGNITO_PASSWORD    That user's password
      (AWS_REGION used for the cognito-idp client)

Optional:
      GATEWAY_REQUEST_TIMEOUT   Per-request timeout in seconds (default: 30).

If any required variable is missing the test is SKIPPED with a message naming
what is absent. It never fails due to missing infrastructure.
"""

from __future__ import annotations

import os
import sys

import pytest

# Make the parent ``agentcore`` package importable (module under test sits two
# levels up from this integration test file).
sys.path.insert(
    0,
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
)


# ---------------------------------------------------------------------------
# Environment gating helpers
# ---------------------------------------------------------------------------

_TRUTHY = {"1", "true", "yes", "on"}


def _is_enabled() -> bool:
    return os.environ.get("INTEGRATION_TEST_ENABLED", "").strip().lower() in _TRUTHY


def _resolve_gateway_url():
    """Return the Gateway MCP endpoint URL, or None if it cannot be resolved."""
    url = os.environ.get("GATEWAY_URL")
    if url:
        return url

    arn = os.environ.get("GATEWAY_ARN")
    if not arn:
        return None

    region = os.environ.get("AWS_REGION")
    if not region:
        try:  # pragma: no cover - depends on local AWS config
            import boto3

            region = boto3.Session().region_name
        except Exception:
            region = None
    if not region:
        return None

    gateway_id = arn.split("/")[-1]
    return (
        f"https://{gateway_id}.gateway.bedrock-agentcore."
        f"{region}.amazonaws.com/mcp"
    )


def _resolve_valid_token():
    """Return a valid Cognito access token, or None if one is unavailable.

    Prefers a pre-supplied ``COGNITO_ACCESS_TOKEN``; otherwise attempts a
    USER_PASSWORD_AUTH exchange when client/username/password are provided.
    """
    token = os.environ.get("COGNITO_ACCESS_TOKEN")
    if token:
        return token

    client_id = os.environ.get("COGNITO_CLIENT_ID")
    username = os.environ.get("COGNITO_USERNAME")
    password = os.environ.get("COGNITO_PASSWORD")
    if not (client_id and username and password):
        return None

    try:  # pragma: no cover - requires live Cognito
        import boto3

        region = os.environ.get("AWS_REGION") or boto3.Session().region_name
        idp = boto3.client("cognito-idp", region_name=region)
        resp = idp.initiate_auth(
            ClientId=client_id,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": username, "PASSWORD": password},
        )
        return resp["AuthenticationResult"]["AccessToken"]
    except Exception as exc:  # pragma: no cover - surfaced as a skip below
        pytest.skip(f"Could not mint a Cognito token via USER_PASSWORD_AUTH: {exc}")
        return None


def _missing_requirements():
    """Return a list of human-readable reasons the test cannot run (empty=ready)."""
    reasons = []
    if not _is_enabled():
        reasons.append("INTEGRATION_TEST_ENABLED is not set to a truthy value")
    if _resolve_gateway_url() is None:
        reasons.append("no GATEWAY_URL or resolvable GATEWAY_ARN (+region)")
    if not (
        os.environ.get("COGNITO_ACCESS_TOKEN")
        or (
            os.environ.get("COGNITO_CLIENT_ID")
            and os.environ.get("COGNITO_USERNAME")
            and os.environ.get("COGNITO_PASSWORD")
        )
    ):
        reasons.append(
            "no valid Cognito token source "
            "(set COGNITO_ACCESS_TOKEN or COGNITO_CLIENT_ID/USERNAME/PASSWORD)"
        )
    return reasons


# Module-level skip: if the environment is not provisioned, skip the whole
# module cleanly at collection time so it never requires live infra to pass.
_MISSING = _missing_requirements()
pytestmark = pytest.mark.skipif(
    bool(_MISSING),
    reason="Gateway JWT integration test disabled: " + "; ".join(_MISSING),
)


def _timeout() -> float:
    try:
        return float(os.environ.get("GATEWAY_REQUEST_TIMEOUT", "30"))
    except ValueError:
        return 30.0


def _list_tools_with_token(token: str) -> list:
    """Connect an MCP client to the Gateway with ``token`` and list tools.

    Uses the production Bearer transport (``streamablehttp_client_with_bearer``)
    wrapped in a strands ``MCPClient`` so the token is forwarded exactly as it
    would be in the runtime. Raises whatever the transport/Gateway raise on an
    auth failure.
    """
    from strands.tools.mcp import MCPClient

    from streamable_http_bearer import streamablehttp_client_with_bearer

    url = _resolve_gateway_url()
    client = MCPClient(
        lambda: streamablehttp_client_with_bearer(
            url=url, token=token, timeout=_timeout()
        )
    )
    with client:
        return client.list_tools_sync()


# ---------------------------------------------------------------------------
# Tests (only run when fully provisioned; otherwise skipped above)
# ---------------------------------------------------------------------------

def test_gateway_accepts_valid_cognito_token():
    """A VALID Cognito access token is accepted: tools/list succeeds (Req 1.5)."""
    token = _resolve_valid_token()
    if not token:  # pragma: no cover - defensive; gating should prevent this
        pytest.skip("No valid Cognito token resolved")

    tools = _list_tools_with_token(token)

    # The Gateway accepted the JWT and returned a (possibly role-filtered) list.
    # We only assert the call succeeded and returned a list — the specific
    # contents are covered by the discovery integration tests (9.3/9.4).
    assert tools is not None
    assert isinstance(tools, list)


@pytest.mark.parametrize(
    "bad_token",
    [
        "not-a-jwt",
        "Bearer.garbage.token",
        # Structurally JWT-shaped but signed with the wrong key / expired.
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJzdWIiOiJhdHRhY2tlciIsInJvbGUiOiJhZG1pbiIsImV4cCI6MTAwMDAwMDAwMH0."
        "invalidsignatureinvalidsignatureinvalidsignature",
        "",
    ],
)
def test_gateway_rejects_invalid_token(bad_token):
    """An INVALID / expired / garbage token is rejected by the Gateway (Req 1.5).

    The Gateway must reject the token at JWT validation (before policy
    evaluation). We assert the MCP call fails by raising — a successful
    ``tools/list`` with a forged token would be a security defect.
    """
    with pytest.raises(BaseException):
        _list_tools_with_token(bad_token)
