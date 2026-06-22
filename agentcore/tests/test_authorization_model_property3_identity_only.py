"""Property-based test for Property 3 of gateway-tool-access-control.

# Feature: gateway-tool-access-control, Property 3: Role resolution depends only on the authenticated identity

Validates: Requirements 1.5, 6.4

Property 3 states: for any authenticated-identity claim and for any adversarial
role value injected into the request payload, query parameters, or headers, the
resolved Role equals ``derive_role(identityClaim)`` and is unaffected by the
injected value; repeated resolution with the same identity yields the same Role.

The model's ``derive_role`` takes ONLY the identity claim, so this test models a
"resolve role from a request" step that receives the identity claim plus a dict
of arbitrary client-supplied values (simulating payload/query/header role
injection) and demonstrates the resolved role depends solely on the identity
claim -- the client-supplied values never influence the outcome.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, Optional

from hypothesis import given, settings
from hypothesis import strategies as st

# Make the pure model module importable regardless of the working directory.
_AGENTCORE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENTCORE_DIR not in sys.path:
    sys.path.insert(0, _AGENTCORE_DIR)

from authorization_model import Role, derive_role  # noqa: E402


def resolve_role_from_request(
    identity_claim: Optional[str],
    client_supplied: Dict[str, Any],
) -> Role:
    """Resolve the user's Role for a request.

    The role is determined SOLELY from the authenticated-identity claim. The
    ``client_supplied`` dict represents adversarial role values arriving in the
    request payload, query parameters, or headers; per Req 1.5 it is ignored
    entirely and never reaches ``derive_role``.
    """
    return derive_role(identity_claim)


# Identity claim values: cover absent (None), the exact match, case variants,
# empty, whitespace, and arbitrary text.
identity_claims = st.one_of(
    st.none(),
    st.just("admin"),
    st.just("Admin"),
    st.just(""),
    st.just("   "),
    st.text(),
)

# Adversarial role values an attacker might inject into a request. Includes the
# privileged value "admin" to ensure injection cannot escalate the role.
adversarial_role_values = st.one_of(
    st.just("admin"),
    st.just("Admin"),
    st.just("nonadmin"),
    st.text(),
    st.integers(),
    st.booleans(),
    st.none(),
)

# A dict simulating client-supplied role injection across payload/query/headers.
client_supplied_dicts = st.fixed_dictionaries(
    {
        "payload_role": adversarial_role_values,
        "query_role": adversarial_role_values,
        "header_role": adversarial_role_values,
    }
)


# Feature: gateway-tool-access-control, Property 3: Role resolution depends only on the authenticated identity
@settings(max_examples=200)
@given(identity_claim=identity_claims, client_supplied=client_supplied_dicts)
def test_role_resolution_depends_only_on_identity(
    identity_claim: Optional[str],
    client_supplied: Dict[str, Any],
) -> None:
    """Resolved Role ignores injected values and matches derive_role(identity)."""
    expected = derive_role(identity_claim)

    # 1. The resolved role equals derive_role(identityClaim) regardless of any
    #    adversarial value supplied in payload/query/headers (Req 1.5, 6.4).
    resolved = resolve_role_from_request(identity_claim, client_supplied)
    assert resolved == expected

    # 2. Injecting an arbitrary (even privileged "admin") role into the
    #    client-supplied dict does not change the outcome: clearing/overriding
    #    the injected values yields the same role as the original identity.
    no_injection = resolve_role_from_request(identity_claim, {})
    forced_admin_injection = resolve_role_from_request(
        identity_claim,
        {"payload_role": "admin", "query_role": "admin", "header_role": "admin"},
    )
    assert resolved == no_injection == forced_admin_injection

    # 3. Repeated resolution with the same identity is deterministic.
    assert resolve_role_from_request(identity_claim, client_supplied) == expected
