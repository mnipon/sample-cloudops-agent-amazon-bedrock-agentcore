"""Property-based test for role derivation (Property 2).

Feature: gateway-tool-access-control

This test exercises ``derive_role`` from ``agentcore.authorization_model`` over a
wide range of role-claim inputs to confirm the admin-only-on-exact-match rule.
"""

from __future__ import annotations

import os
import sys

from hypothesis import given, settings
from hypothesis import strategies as st

# Make the parent ``agentcore`` package importable when the test is run from an
# arbitrary working directory (the module under test sits one level up).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from authorization_model import ADMIN_CLAIM, Role, derive_role


# A strategy that intelligently covers the input space for the role claim:
#   - the exact admin token "admin"
#   - case variants such as "Admin" / "ADMIN" that must NOT match
#   - whitespace-padded variants of "admin" that must NOT match
#   - the empty string and whitespace-only strings
#   - arbitrary text (which may, rarely, also generate "admin")
#   - None (an absent claim)
_role_claims = st.one_of(
    st.just("admin"),
    st.sampled_from(["Admin", "ADMIN", "aDmIn", "admin ", " admin", "\tadmin", "admins"]),
    st.just(""),
    st.text(alphabet=" \t\n\r\f\v", min_size=1, max_size=8),  # whitespace-only
    st.text(max_size=20),  # arbitrary strings
    st.none(),
)


# Feature: gateway-tool-access-control, Property 2: Role derivation is admin-only-on-exact-match, NonAdmin otherwise
@settings(max_examples=200)
@given(role_claim=_role_claims)
def test_role_derivation_admin_only_on_exact_match(role_claim):
    """``derive_role`` returns ``Admin`` iff the claim is exactly ``"admin"``.

    For every other input -- a different string, a different case, the empty
    string, whitespace, or an absent claim (``None``) -- it returns ``NonAdmin``.

    Validates: Requirements 1.2, 1.3, 1.4, 6.5, 7.4
    """
    result = derive_role(role_claim)

    if role_claim == ADMIN_CLAIM:
        assert result is Role.Admin
    else:
        assert result is Role.NonAdmin

    # The function is total over this input space: it only ever yields one of
    # the two recognized roles.
    assert result in (Role.Admin, Role.NonAdmin)
