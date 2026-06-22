"""Property-based test for the authorization decision (Property 5).

Feature: gateway-tool-access-control, Property 5: Authorization allows exactly
the categories in the role's allowed set

Validates: Requirements 2.3, 3.3, 4.1, 4.3, 5.1, 5.2, 5.3

This test exercises ``authorize(role, category)`` from
``agentcore/authorization_model.py`` over:
  - every known ``ToolCategory`` (as enum members and as their bare string
    values),
  - arbitrary unknown / newly-generated category strings,
  - the empty string,
for both roles. The universal property asserted is the default-deny
biconditional: ``authorize`` returns ``Allow`` if and only if the category
resolves to a member of ``ALLOWED(role)``, and ``Deny`` in every other case
(in particular, every unknown category is always ``Deny``).
"""

from __future__ import annotations

import os
import sys

from hypothesis import given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from authorization_model import (  # noqa: E402
    ALLOWED,
    CategoryLike,
    Decision,
    Role,
    ToolCategory,
    authorize,
)

# The set of strings that name a known category. Any generated string outside
# this set is, by definition, an unknown category and must always be denied.
_KNOWN_CATEGORY_VALUES = frozenset(c.value for c in ToolCategory)


def _resolves_to_allowed(role: Role, category: CategoryLike) -> bool:
    """Reference oracle: does ``category`` resolve to a member of ALLOWED(role)?

    Independently re-derives the expected decision from the authoritative
    mapping without calling into the module's private helpers, so the test does
    not merely restate the implementation.
    """
    allowed = ALLOWED.get(role, frozenset())
    if isinstance(category, ToolCategory):
        return category in allowed
    if isinstance(category, str):
        try:
            known = ToolCategory(category)
        except ValueError:
            return False
        return known in allowed
    return False


# Roles: both defined roles.
_roles = st.sampled_from(list(Role))

# Known categories supplied either as enum members or as their string values
# (both are valid inputs at the authorization boundary).
_known_categories = st.one_of(
    st.sampled_from(list(ToolCategory)),
    st.sampled_from(sorted(_KNOWN_CATEGORY_VALUES)),
)

# Arbitrary strings that are NOT known category names (unknown / newly-generated
# categories), plus the empty string explicitly.
_unknown_categories = st.one_of(
    st.just(""),
    st.text().filter(lambda s: s not in _KNOWN_CATEGORY_VALUES),
)

# The full category input space the property ranges over.
_categories = st.one_of(_known_categories, _unknown_categories)


@settings(max_examples=300)
@given(role=_roles, category=_categories)
def test_authorize_allows_iff_category_in_allowed_set(
    role: Role, category: CategoryLike
) -> None:
    """authorize returns Allow iff category ∈ ALLOWED(role), else Deny."""
    decision = authorize(role, category)
    expected_allow = _resolves_to_allowed(role, category)

    if expected_allow:
        assert decision == Decision.Allow
    else:
        assert decision == Decision.Deny


@settings(max_examples=200)
@given(role=_roles, category=_unknown_categories)
def test_authorize_denies_all_unknown_categories(
    role: Role, category: str
) -> None:
    """Unknown / newly-generated categories are always denied (default-deny)."""
    assert authorize(role, category) == Decision.Deny
