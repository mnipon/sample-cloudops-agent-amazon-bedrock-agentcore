# Feature: gateway-tool-access-control, Property 1: Role-claim mapping yields exactly one role
# **Validates: Requirements 1.1**
"""
Property-based test for the role-claim mapping (Property 1).

Over arbitrary Cognito group-membership sets, ``map_groups_to_role_claim``
must produce exactly one scalar value drawn from ``{"admin", "nonadmin"}``, and
that value must be ``"admin"`` if and only if the ``Administrators`` group is
present in the membership.

Generators deliberately cover the edge cases called out by the design:
empty group collections, collections with and without ``Administrators``,
arbitrary other group names, duplicate group entries, and an absent claim
(``None``).
"""

import os
import sys

from hypothesis import given, settings
from hypothesis import strategies as st

# Ensure the `agentcore` package directory is importable so the pure model
# module can be imported directly, mirroring how it is consumed at runtime.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from authorization_model import (  # noqa: E402
    ADMIN_CLAIM,
    ADMIN_GROUP,
    NONADMIN_CLAIM,
    map_groups_to_role_claim,
)


# --- Strategies ---

# Arbitrary group names, including ones that look similar to the admin group
# (different case, substrings) to guard against loose matching. The admin group
# itself is included so it can appear naturally, and is also injected
# explicitly below to ensure both branches are exercised frequently.
_group_name_strategy = st.one_of(
    st.text(min_size=0, max_size=12),
    st.sampled_from(
        [
            ADMIN_GROUP,
            ADMIN_GROUP.lower(),
            ADMIN_GROUP.upper(),
            "administrator",
            "Admins",
            "ReadOnly",
            "billing",
            "pricing",
            "",
        ]
    ),
)

# A list of arbitrary group names (may or may not contain Administrators), with
# duplicates allowed by construction.
_groups_list_strategy = st.lists(_group_name_strategy, min_size=0, max_size=10)


def _membership_strategy():
    """Generate group memberships covering all the relevant shapes.

    Yields: ``None`` (absent claim), arbitrary lists, lists guaranteed to
    contain ``Administrators`` (possibly duplicated), and tuple/set forms to
    confirm the mapping is agnostic to the iterable type.
    """
    base = _groups_list_strategy

    with_admin = st.builds(
        lambda groups, n: groups + [ADMIN_GROUP] * n,
        base,
        st.integers(min_value=1, max_value=3),
    )

    as_tuple = base.map(tuple)
    as_set = base.map(set)

    return st.one_of(
        st.none(),
        base,
        with_admin,
        as_tuple,
        as_set,
    )


# --- Property ---


@settings(max_examples=200, deadline=None)
@given(groups=_membership_strategy())
def test_role_claim_mapping_yields_exactly_one_role(groups):
    """The claim mapping returns exactly one valid value, admin iff Administrators present."""
    claim = map_groups_to_role_claim(groups)

    # Exactly one value, drawn from the allowed scalar set.
    assert claim in {ADMIN_CLAIM, NONADMIN_CLAIM}, (
        f"claim {claim!r} is not one of {{{ADMIN_CLAIM!r}, {NONADMIN_CLAIM!r}}}"
    )

    # "admin" if and only if the Administrators group is present.
    administrators_present = groups is not None and ADMIN_GROUP in groups
    if administrators_present:
        assert claim == ADMIN_CLAIM, (
            f"Administrators present but claim was {claim!r}"
        )
    else:
        assert claim == NONADMIN_CLAIM, (
            f"Administrators absent but claim was {claim!r}"
        )
