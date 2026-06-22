"""Integration test: Admin discovery and invocation (Task 9.3).

Feature: gateway-tool-access-control

This is a LIVE-INFRASTRUCTURE integration test. It exercises the deployed
AgentCore Gateway (with the CUSTOM_JWT authorizer and the Cedar Policy engine)
end-to-end using a real Admin user's Cognito access token. It verifies:

  * Discovery (``tools/list``, paginated): an Admin token returns tools from
    ALL FIVE categories — billing, pricing, cloudwatch, cloudtrail, inventory
    (tool-name prefixes ``billingMcp___``, ``pricingMcp___``,
    ``cloudwatchMcp___``, ``cloudtrailMcp___``, ``inventoryMcp___``).
    Validates Requirement 2.2.

  * Invocation routing: invoking one representative tool per category routes to
    its target — i.e. the call is NOT rejected with an authorization denial.
    Tool-level / business errors (bad/empty arguments, target hiccups) are
    tolerated; only an authorization denial fails the assertion.
    Validates Requirement 2.3.

Because this requires deployed infrastructure and a valid Admin token, the
whole module AUTO-SKIPS unless the environment is configured. Nothing here
requires live infra to be *collected*; it skips cleanly when the env vars are
absent.

------------------------------------------------------------------------------
Required environment variables
------------------------------------------------------------------------------
  INTEGRATION_TEST_ENABLED   Must be truthy (``1``/``true``/``yes``/``on``) to
                             opt in to running live integration tests. When
                             unset/false, the entire module is skipped.

  GATEWAY_URL                The deployed Gateway MCP endpoint URL the client
                             connects to (e.g.
                             ``https://<gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp``).
                             ``GATEWAY_ARN`` is accepted as a fallback only if
                             it is already an https URL; an ARN alone is not a
                             usable MCP endpoint and results in a skip.

  Admin token — provide ONE of:
    ADMIN_COGNITO_TOKEN  (or ADMIN_ACCESS_TOKEN)
                             A pre-fetched Admin user's Cognito access token
                             (carrying ``role=admin``).
    -- or the credentials to mint one via Cognito USER_PASSWORD_AUTH --
    COGNITO_CLIENT_ID        App client id for USER_PASSWORD_AUTH.
    ADMIN_USERNAME           Admin user's username.
    ADMIN_PASSWORD           Admin user's password.
    AWS_REGION / AWS_DEFAULT_REGION   Region for the Cognito IdP call.

If neither a token nor a full set of Cognito credentials is available, the
module skips.
"""

from __future__ import annotations

import os
import sys
import uuid

import pytest

# Make the ``agentcore`` package importable whether pytest is run from the
# repo root or from the ``agentcore`` directory. The integration test lives
# two levels below ``agentcore`` (agentcore/tests/integration/), so add the
# package root to sys.path.
_AGENTCORE_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if _AGENTCORE_ROOT not in sys.path:
    sys.path.insert(0, _AGENTCORE_ROOT)

# Mark every test in this module as an integration test so the suite can
# deselect with ``-m "not integration"``.
pytestmark = pytest.mark.integration


# The five tool categories and their Gateway tool-name prefixes (per design's
# "Tool categories" data model).
CATEGORY_PREFIXES = {
    "billing": "billingMcp___",
    "pricing": "pricingMcp___",
    "cloudwatch": "cloudwatchMcp___",
    "cloudtrail": "cloudtrailMcp___",
    "inventory": "inventoryMcp___",
}


def _truthy(value) -> bool:
    """Return True for the usual opt-in string values."""
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _resolve_gateway_url():
    """Resolve the Gateway MCP endpoint URL, or None if not usable."""
    url = os.environ.get("GATEWAY_URL")
    if url and url.strip():
        return url.strip()
    # Accept GATEWAY_ARN only when it is already an https URL; a bare ARN is
    # not a connectable MCP endpoint.
    arn = os.environ.get("GATEWAY_ARN", "")
    if arn.strip().lower().startswith("https://"):
        return arn.strip()
    return None


def _resolve_admin_token():
    """Resolve an Admin Cognito access token.

    Prefers a pre-supplied token; otherwise mints one via Cognito
    USER_PASSWORD_AUTH when the client id and admin credentials are present.
    Returns the token string, or None when nothing is configured (caller skips).
    """
    token = os.environ.get("ADMIN_COGNITO_TOKEN") or os.environ.get("ADMIN_ACCESS_TOKEN")
    if token and token.strip():
        return token.strip()

    client_id = os.environ.get("COGNITO_CLIENT_ID")
    username = os.environ.get("ADMIN_USERNAME")
    password = os.environ.get("ADMIN_PASSWORD")
    if not (client_id and username and password):
        return None

    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    )
    try:
        import boto3  # imported lazily so collection never requires boto3

        idp = boto3.client("cognito-idp", region_name=region)
        resp = idp.initiate_auth(
            ClientId=client_id,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": username, "PASSWORD": password},
        )
        return resp["AuthenticationResult"]["AccessToken"]
    except Exception as exc:  # pragma: no cover - depends on live Cognito
        pytest.skip(f"Could not obtain Admin Cognito token: {exc}")


def _tool_name(tool) -> str:
    """Best-effort extraction of a tool's Gateway name across strands shapes."""
    for attr in ("tool_name", "name"):
        value = getattr(tool, attr, None)
        if isinstance(value, str) and value:
            return value
    spec = getattr(tool, "tool_spec", None)
    if isinstance(spec, dict) and isinstance(spec.get("name"), str):
        return spec["name"]
    return str(tool)


@pytest.fixture(scope="module")
def gateway_url():
    if not _truthy(os.environ.get("INTEGRATION_TEST_ENABLED")):
        pytest.skip("INTEGRATION_TEST_ENABLED is not set; skipping live integration test")
    url = _resolve_gateway_url()
    if not url:
        pytest.skip("GATEWAY_URL (or an https GATEWAY_ARN) is not set; skipping")
    return url


@pytest.fixture(scope="module")
def admin_token():
    if not _truthy(os.environ.get("INTEGRATION_TEST_ENABLED")):
        pytest.skip("INTEGRATION_TEST_ENABLED is not set; skipping live integration test")
    token = _resolve_admin_token()
    if not token:
        pytest.skip(
            "No Admin token available (set ADMIN_COGNITO_TOKEN, or "
            "COGNITO_CLIENT_ID + ADMIN_USERNAME + ADMIN_PASSWORD); skipping"
        )
    return token


@pytest.fixture(scope="module")
def admin_tools(gateway_url, admin_token):
    """Connect as the Admin user and return the full, paginated tool list."""
    from strands.tools.mcp import MCPClient
    from streamable_http_bearer import streamablehttp_client_with_bearer

    client = MCPClient(
        lambda: streamablehttp_client_with_bearer(url=gateway_url, token=admin_token)
    )

    collected = []
    with client:
        pagination_token = None
        while True:
            page = client.list_tools_sync(pagination_token=pagination_token)
            collected.extend(page)
            next_token = getattr(page, "pagination_token", None)
            if next_token:
                pagination_token = next_token
            else:
                break
    return collected


def test_admin_discovery_returns_all_five_categories(admin_tools):
    """Admin ``tools/list`` returns tools from ALL FIVE categories (Req 2.2)."""
    assert admin_tools, "Admin tools/list returned no tools"

    names = [_tool_name(tool) for tool in admin_tools]

    missing = [
        category
        for category, prefix in CATEGORY_PREFIXES.items()
        if not any(name.startswith(prefix) for name in names)
    ]
    assert not missing, (
        f"Admin discovery missing categories {missing}; "
        f"observed tool names: {sorted(names)}"
    )


def test_admin_invocation_of_each_category_routes(gateway_url, admin_token, admin_tools):
    """Invoking one tool per category routes to its target, not an auth denial.

    Validates Requirement 2.3: for an Admin, a representative tool in each of
    the five categories is reachable. Tool-level/business errors (e.g. invalid
    or empty arguments) are tolerated — the assertion is only that the call is
    NOT rejected with an authorization denial (which would mean it never routed
    to the target).
    """
    from strands.tools.mcp import MCPClient
    from streamable_http_bearer import streamablehttp_client_with_bearer
    from authorization_model import is_authorization_denial

    # Pick one representative tool name per category from what was discovered.
    representative = {}
    for tool in admin_tools:
        name = _tool_name(tool)
        for category, prefix in CATEGORY_PREFIXES.items():
            if category not in representative and name.startswith(prefix):
                representative[category] = name

    missing = [c for c in CATEGORY_PREFIXES if c not in representative]
    assert not missing, f"No discoverable tool to invoke for categories {missing}"

    client = MCPClient(
        lambda: streamablehttp_client_with_bearer(url=gateway_url, token=admin_token)
    )

    denied = {}
    with client:
        for category, tool_name in representative.items():
            try:
                result = client.call_tool_sync(
                    tool_use_id=f"it-{uuid.uuid4()}",
                    name=tool_name,
                    arguments={},
                )
            except Exception as exc:  # noqa: BLE001 - classify, don't swallow blindly
                # A raised exception only fails the test if it is an
                # authorization denial; other failures mean the request still
                # reached/attempted the target (acceptable for routing).
                if is_authorization_denial(exc):
                    denied[category] = repr(exc)
                continue

            # A returned (non-raising) result: ensure it is not an auth denial.
            if is_authorization_denial(result) or is_authorization_denial(
                getattr(result, "content", result)
            ):
                denied[category] = repr(result)

    assert not denied, (
        "Admin invocation was authorization-denied for categories "
        f"{sorted(denied)} (each should route to its target): {denied}"
    )
