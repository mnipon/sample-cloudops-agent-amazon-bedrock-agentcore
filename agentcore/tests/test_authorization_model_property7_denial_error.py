"""Property-based test for denial-error data exclusion (Property 7).

Feature: gateway-tool-access-control, Property 7: Denial errors identify the category and exclude all tool data

Validates: Requirements 4.4, 8.1

This test exercises ``format_authorization_error(denied_category)`` and the
``AuthorizationError`` dataclass from ``agentcore/authorization_model.py``.

For any denied ``(role, category)`` decision -- a known category that is not in
the role's allowed set (e.g. cloudwatch/cloudtrail/inventory for NonAdmin), or
any unknown / newly-generated category, including the empty string -- together
with arbitrary tool input arguments, output payloads, and result data, the
produced error MUST:

  1. identify the denied category (its identifier appears in the serialized
     error and the ``denied_category`` field equals the expected name), and
  2. contain none of the supplied tool data.

To make the exclusion assertion meaningful (not trivially true), every string
leaf in the generated tool data is tagged with a distinctive sentinel prefix so
that, if any tool value leaked into the error, the sentinel would be detected.
"""

from __future__ import annotations

import os
import sys
from typing import Any, List

from hypothesis import assume, given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from authorization_model import (  # noqa: E402
    ALLOWED,
    AuthorizationError,
    CategoryLike,
    Decision,
    Role,
    ToolCategory,
    authorize,
    format_authorization_error,
)

# Distinctive marker embedded in every generated tool-data string leaf. It is
# chosen so it cannot collide with a category identifier or the fixed message
# text, which makes "this value did not leak into the error" a real check.
_SENTINEL = "SENTINEL_TOOLDATA_"

_KNOWN_CATEGORY_VALUES = frozenset(c.value for c in ToolCategory)


def _expected_category_name(category: CategoryLike) -> str:
    """Reference oracle for the category identifier the error should report."""
    if isinstance(category, ToolCategory):
        return category.value
    if isinstance(category, str) and category in _KNOWN_CATEGORY_VALUES:
        return ToolCategory(category).value
    return str(category)


def _collect_sentinel_values(data: Any) -> List[str]:
    """Recursively gather every sentinel-tagged string leaf from tool data."""
    found: List[str] = []
    if isinstance(data, str):
        if _SENTINEL in data:
            found.append(data)
    elif isinstance(data, dict):
        for value in data.values():
            found.extend(_collect_sentinel_values(value))
    elif isinstance(data, (list, tuple)):
        for value in data:
            found.extend(_collect_sentinel_values(value))
    return found


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

_roles = st.sampled_from(list(Role))

# Categories the error may be produced for: known categories (enum or string),
# arbitrary unknown strings, and the empty string.
_categories = st.one_of(
    st.sampled_from(list(ToolCategory)),
    st.sampled_from(sorted(_KNOWN_CATEGORY_VALUES)),
    st.just(""),
    st.text(),
)

# Every text leaf in the tool data carries the sentinel prefix so leakage is
# detectable; non-text leaves cover other value shapes.
_sentinel_text = st.text(min_size=1).map(lambda s: _SENTINEL + s)
_leaf = st.one_of(
    _sentinel_text,
    st.integers(),
    st.booleans(),
    st.none(),
    st.floats(allow_nan=False, allow_infinity=False),
)
_tool_data = st.recursive(
    _leaf,
    lambda children: st.one_of(
        st.lists(children, max_size=4),
        st.dictionaries(st.text(min_size=1), children, max_size=4),
    ),
    max_leaves=10,
)


@settings(max_examples=200)
@given(
    role=_roles,
    category=_categories,
    tool_args=_tool_data,
    tool_output=_tool_data,
    tool_result=_tool_data,
)
def test_denial_error_names_category_and_excludes_tool_data(
    role: Role,
    category: CategoryLike,
    tool_args: Any,
    tool_output: Any,
    tool_result: Any,
) -> None:
    """A denial error names the denied category and leaks no tool data."""
    # Restrict to genuinely denied (role, category) decisions.
    assume(authorize(role, category) == Decision.Deny)

    error = format_authorization_error(category)

    # The produced value is the expected dataclass.
    assert isinstance(error, AuthorizationError)

    # 1. The error identifies the denied category.
    expected_name = _expected_category_name(category)
    assert error.denied_category == expected_name

    serialized_parts = [
        error.denied_category,
        error.message,
        str(error),
        repr(error),
        str(error.to_dict()),
    ]
    serialized = "\n".join(serialized_parts)

    # For a non-empty category identifier, its name must appear in the message
    # so the user can tell which category was denied.
    if expected_name:
        assert expected_name in error.message

    # 2. None of the supplied tool data appears anywhere in the serialized error.
    sentinel_values = (
        _collect_sentinel_values(tool_args)
        + _collect_sentinel_values(tool_output)
        + _collect_sentinel_values(tool_result)
    )
    for value in sentinel_values:
        assert value not in serialized
    # The sentinel marker itself must never surface in the error.
    assert _SENTINEL not in serialized
