"""Property-based test for the role-to-category mapping.

Feature: gateway-tool-access-control, Property 4: Role-to-category mapping is total and exact

Validates: Requirements 2.1, 3.1, 4.1, 6.1, 6.2, 6.3
"""

from __future__ import annotations

import os
import sys

from hypothesis import given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from authorization_model import ALLOWED, Role, ToolCategory


# The exact category sets the design declares as authoritative (design.md,
# "Role -> Allowed categories mapping").
ADMIN_CATEGORIES = frozenset(
    {
        ToolCategory.billing,
        ToolCategory.pricing,
        ToolCategory.cloudwatch,
        ToolCategory.cloudtrail,
        ToolCategory.inventory,
    }
)
NONADMIN_CATEGORIES = frozenset({ToolCategory.billing, ToolCategory.pricing})
DENIED_FOR_NONADMIN = frozenset(
    {ToolCategory.cloudwatch, ToolCategory.cloudtrail, ToolCategory.inventory}
)


# Feature: gateway-tool-access-control, Property 4: Role-to-category mapping is total and exact
@settings(max_examples=200)
@given(role=st.sampled_from(list(Role)))
def test_role_to_category_mapping_is_total_and_exact(role: Role) -> None:
    # Total: ALLOWED is defined for every Role member.
    assert role in ALLOWED, f"ALLOWED has no entry for role {role!r}"

    allowed = ALLOWED[role]

    # Exact: each role maps to precisely its declared category set.
    if role is Role.Admin:
        assert allowed == ADMIN_CATEGORIES
        # Admin includes every defined category (none excluded).
        assert allowed == frozenset(ToolCategory)
    elif role is Role.NonAdmin:
        assert allowed == NONADMIN_CATEGORIES
        # cloudwatch, cloudtrail, and inventory are excluded for NonAdmin.
        assert DENIED_FOR_NONADMIN.isdisjoint(allowed)
    else:  # pragma: no cover - guards against a new, untested Role member.
        raise AssertionError(f"Unhandled role {role!r}")


# Feature: gateway-tool-access-control, Property 4: Role-to-category mapping is total and exact
@settings(max_examples=200)
@given(role=st.sampled_from(list(Role)))
def test_allowed_is_total_over_every_role(role: Role) -> None:
    # Totality restated independently: sampling over every Role member, the
    # mapping always resolves to a concrete set of known ToolCategory values.
    allowed = ALLOWED[role]
    assert isinstance(allowed, frozenset)
    assert allowed, f"ALLOWED({role!r}) must be non-empty"
    assert all(isinstance(c, ToolCategory) for c in allowed)
