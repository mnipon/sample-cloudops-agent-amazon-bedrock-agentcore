"""Property-based test for discovery filtering (Property 6).

Feature: gateway-tool-access-control, Property 6: Discovery filtering returns exactly the allowed tools and no denied tools

Validates: Requirements 2.2, 3.2, 4.2, 5.4

This test exercises ``discovery_filter(role, catalog)`` and the ``Tool``
dataclass from ``agentcore/authorization_model.py`` over:
  - both defined roles,
  - tool catalogs whose tools are tagged with a mix of known ``ToolCategory``
    values (as enum members and as their bare string values) and arbitrary
    unknown / newly-registered category strings (incl. the empty string).

The universal property asserted is: ``discovery_filter`` includes every tool
whose category is in ``ALLOWED(role)`` and excludes every tool whose category
is absent from ``ALLOWED(role)`` (default-deny). In particular, for
``NonAdmin`` no tool from cloudwatch, cloudtrail, inventory, or any unknown
category appears in the result.
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
    Role,
    Tool,
    ToolCategory,
    discovery_filter,
)

# Strings that name a known category. Any generated string outside this set is,
# by definition, an unknown category and must always be excluded.
_KNOWN_CATEGORY_VALUES = frozenset(c.value for c in ToolCategory)

# Categories that NonAdmin must never be able to discover.
_NONADMIN_FORBIDDEN_VALUES = frozenset(
    {
        ToolCategory.cloudwatch.value,
        ToolCategory.cloudtrail.value,
        ToolCategory.inventory.value,
    }
)


def _resolves_to_allowed(role: Role, category: CategoryLike) -> bool:
    """Reference oracle: does ``category`` resolve to a member of ALLOWED(role)?

    Independently re-derives the expected outcome from the authoritative
    mapping, so the test does not merely restate the implementation.
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
# (both are valid tags at the discovery boundary).
_known_categories = st.one_of(
    st.sampled_from(list(ToolCategory)),
    st.sampled_from(sorted(_KNOWN_CATEGORY_VALUES)),
)

# Arbitrary strings that are NOT known category names (unknown / newly-added
# categories), plus the empty string explicitly.
_unknown_categories = st.one_of(
    st.just(""),
    st.text().filter(lambda s: s not in _KNOWN_CATEGORY_VALUES),
)

# The full category tag space a tool may carry.
_categories = st.one_of(_known_categories, _unknown_categories)

# A single tool: a unique-ish name plus a (possibly unknown) category tag.
_tools = st.builds(Tool, name=st.text(min_size=1), category=_categories)

# A catalog of tools (may be empty, may repeat categories).
_catalogs = st.lists(_tools, max_size=20)


@settings(max_examples=300)
@given(role=_roles, catalog=_catalogs)
def test_discovery_filter_returns_exactly_allowed_tools(
    role: Role, catalog: list
) -> None:
    """Result includes every allowed-category tool and no denied-category tool."""
    result = discovery_filter(role, catalog)

    expected_allowed = [t for t in catalog if _resolves_to_allowed(role, t.category)]
    expected_denied = [
        t for t in catalog if not _resolves_to_allowed(role, t.category)
    ]

    # Every allowed-category tool is present (order preserved).
    assert result == expected_allowed

    # No denied-category tool leaks into the result.
    result_ids = {id(t) for t in result}
    for denied in expected_denied:
        assert id(denied) not in result_ids

    # Every tool in the result has a category permitted for the role.
    for tool in result:
        assert _resolves_to_allowed(role, tool.category)


@settings(max_examples=200)
@given(catalog=_catalogs)
def test_nonadmin_discovers_no_forbidden_or_unknown_categories(
    catalog: list,
) -> None:
    """For NonAdmin, no cloudwatch/cloudtrail/inventory/unknown tool appears."""
    result = discovery_filter(Role.NonAdmin, catalog)

    for tool in result:
        category = tool.category
        category_value = (
            category.value if isinstance(category, ToolCategory) else category
        )
        # No denied known category.
        assert category_value not in _NONADMIN_FORBIDDEN_VALUES
        # No unknown category.
        assert category_value in _KNOWN_CATEGORY_VALUES
        # Concretely, NonAdmin only ever discovers billing or pricing.
        assert category_value in {
            ToolCategory.billing.value,
            ToolCategory.pricing.value,
        }
