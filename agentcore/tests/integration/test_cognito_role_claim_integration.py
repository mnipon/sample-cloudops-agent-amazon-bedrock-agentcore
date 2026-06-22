"""Integration test: Cognito issues a token carrying the ``role`` claim (Task 9.1).

Feature: gateway-tool-access-control

This is an INTEGRATION test. It exercises a *live* Amazon Cognito User Pool that
has the Pre-Token-Generation Lambda attached (see AuthStack / Task 3). The test
authenticates a real admin user and a real non-admin user, decodes the returned
ID and access tokens, and asserts the injected scalar ``role`` claim equals
``"admin"`` for the admin user and ``"nonadmin"`` for the non-admin user in
*both* tokens.

Because it depends on deployed infrastructure and real credentials, the test
SKIPS automatically (it never errors) when any required environment variable is
missing. This keeps the test collectable and the suite green without live infra.

Validates: Requirements 1.1, 7.1

------------------------------------------------------------------------------
Required environment variables (all must be set for the test to run):
------------------------------------------------------------------------------
  INTEGRATION_TEST_ENABLED   Master switch. Must be a truthy value
                             ("1", "true", "yes", "on") to enable the test.
  COGNITO_USER_POOL_ID       The Cognito User Pool ID (e.g. us-east-1_ABC123).
                             Currently used for documentation/context; the
                             USER_PASSWORD_AUTH flow keys off the app client.
  COGNITO_CLIENT_ID          The Cognito User Pool *app client* ID used for the
                             USER_PASSWORD_AUTH initiate_auth flow.
  COGNITO_ADMIN_USERNAME     Username of a user who is a member of the
                             ``Administrators`` group (expected role "admin").
  COGNITO_ADMIN_PASSWORD     Password for the admin user.
  COGNITO_NONADMIN_USERNAME  Username of a user who is NOT in ``Administrators``
                             (expected role "nonadmin").
  COGNITO_NONADMIN_PASSWORD  Password for the non-admin user.

Optional:
  AWS_REGION / AWS_DEFAULT_REGION
                             Region for the cognito-idp client. If the User Pool
                             ID encodes a region (``<region>_xxxxx``), that
                             region is used as a fallback.

The test uses the unauthenticated ``initiate_auth`` USER_PASSWORD_AUTH flow
(no AWS credentials needed) so it can run from CI with only the Cognito app
client configured for that flow. Tokens are decoded WITHOUT signature
verification — the assertion only inspects the ``role`` claim, and the token's
authenticity is already guaranteed by Cognito having issued it.
"""

from __future__ import annotations

import base64
import json
import os

import pytest

# ---------------------------------------------------------------------------
# Environment-variable driven skip gate
# ---------------------------------------------------------------------------

_REQUIRED_ENV_VARS = (
    "COGNITO_USER_POOL_ID",
    "COGNITO_CLIENT_ID",
    "COGNITO_ADMIN_USERNAME",
    "COGNITO_ADMIN_PASSWORD",
    "COGNITO_NONADMIN_USERNAME",
    "COGNITO_NONADMIN_PASSWORD",
)

_TRUTHY = {"1", "true", "yes", "on"}


def _integration_enabled() -> bool:
    """True only when integration tests are explicitly enabled."""
    return os.environ.get("INTEGRATION_TEST_ENABLED", "").strip().lower() in _TRUTHY


def _missing_env_vars() -> list[str]:
    """Names of required env vars that are absent or empty."""
    return [name for name in _REQUIRED_ENV_VARS if not os.environ.get(name)]


def _skip_reason() -> str | None:
    """Return a skip reason string, or None when the test should run."""
    if not _integration_enabled():
        return (
            "integration tests disabled: set INTEGRATION_TEST_ENABLED=1 and the "
            "COGNITO_* env vars to run this live Cognito integration test"
        )
    missing = _missing_env_vars()
    if missing:
        return "missing required integration env vars: " + ", ".join(missing)
    return None


# Module-level skip gate. Evaluated at collection time so the test SKIPS (rather
# than errors) whenever the infrastructure/credentials are not configured.
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(_skip_reason() is not None, reason=_skip_reason() or ""),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decode_jwt_claims(token: str) -> dict:
    """Decode the claims (payload) of a JWT without verifying its signature.

    A JWT is ``<header>.<payload>.<signature>`` where each segment is
    base64url-encoded. We only need the payload to read the ``role`` claim; the
    token's authenticity is established by Cognito having issued it.
    """
    parts = token.split(".")
    assert len(parts) == 3, "expected a three-segment JWT (header.payload.signature)"
    payload_b64 = parts[1]
    # Restore base64url padding (length must be a multiple of 4).
    padding = "=" * (-len(payload_b64) % 4)
    decoded = base64.urlsafe_b64decode(payload_b64 + padding)
    return json.loads(decoded)


def _resolve_region() -> str | None:
    """Determine the AWS region for the cognito-idp client."""
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    if region:
        return region
    # Fall back to the region encoded in the User Pool ID (``<region>_xxxxx``).
    pool_id = os.environ.get("COGNITO_USER_POOL_ID", "")
    if "_" in pool_id:
        return pool_id.split("_", 1)[0]
    return None


def _authenticate(client, username: str, password: str) -> dict:
    """Run USER_PASSWORD_AUTH and return the AuthenticationResult dict."""
    response = client.initiate_auth(
        ClientId=os.environ["COGNITO_CLIENT_ID"],
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )
    auth_result = response.get("AuthenticationResult")
    assert auth_result is not None, (
        "USER_PASSWORD_AUTH did not return AuthenticationResult; "
        "a challenge may be pending for this user"
    )
    return auth_result


def _assert_role_in_both_tokens(auth_result: dict, expected_role: str, who: str):
    """Assert the ``role`` claim equals ``expected_role`` in ID and access tokens."""
    for token_name in ("IdToken", "AccessToken"):
        token = auth_result.get(token_name)
        assert token, f"{who}: missing {token_name} in AuthenticationResult"
        claims = _decode_jwt_claims(token)
        assert "role" in claims, (
            f"{who}: {token_name} has no 'role' claim; the Pre-Token-Generation "
            f"Lambda may not be attached. Claims present: {sorted(claims)}"
        )
        assert claims["role"] == expected_role, (
            f"{who}: {token_name} 'role' claim is {claims['role']!r}, "
            f"expected {expected_role!r}"
        )


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

def test_cognito_issues_role_claim_for_admin_and_nonadmin():
    """Cognito injects role="admin" for admins and "nonadmin" for non-admins.

    The Pre-Token-Generation Lambda derives the scalar ``role`` claim from
    ``Administrators`` group membership and adds it to both the ID and access
    tokens. This test verifies that end-to-end against the live User Pool.
    """
    boto3 = pytest.importorskip("boto3", reason="boto3 is required for the live test")

    region = _resolve_region()
    client = boto3.client("cognito-idp", region_name=region) if region else boto3.client(
        "cognito-idp"
    )

    # Admin user -> role == "admin" in both tokens.
    admin_result = _authenticate(
        client,
        os.environ["COGNITO_ADMIN_USERNAME"],
        os.environ["COGNITO_ADMIN_PASSWORD"],
    )
    _assert_role_in_both_tokens(admin_result, "admin", who="admin user")

    # Non-admin user -> role == "nonadmin" in both tokens.
    nonadmin_result = _authenticate(
        client,
        os.environ["COGNITO_NONADMIN_USERNAME"],
        os.environ["COGNITO_NONADMIN_PASSWORD"],
    )
    _assert_role_in_both_tokens(nonadmin_result, "nonadmin", who="non-admin user")
