"""Property-based test for the Agent Runtime denial response (Property 9).

Feature: gateway-tool-access-control, Property 9: The Agent Runtime's denial response states unavailability and excludes tool data

Validates: Requirements 8.5

This test exercises ``build_denial_response(category_or_error, *, session_id,
user_id)`` from ``agentcore/authorization_model.py``. That helper is the pure,
dependency-free surface the Agent Runtime uses to turn a Gateway/Policy
authorization denial into a role-appropriate, data-free user response, and it is
importable WITHOUT the AWS / strands / mcp dependencies the runtime module pulls
in (task 6.4 placed it here for exactly this reason).

For any authorization error -- a denied category passed directly, or an
exception in a variety of shapes (a plain ``Exception`` whose message names
``AuthorizeActionException`` plus a Gateway target prefix such as
``cloudwatchMcp___get_metric_data``, or an ``McpError``-like object carrying a
nested ``ErrorData`` message) -- and for any arbitrary denied-tool payload
(input arguments, output payload, result data) embedded in the error, the
produced response MUST:

  1. state that the requested capability is not available for the user's role
     (the ``result`` message matches /not available for your role/i and the
     ``denied`` flag is ``True``), and
  2. contain NONE of the denied tool's data.

To make the exclusion assertion meaningful (not trivially true), every string
leaf of the generated tool data carries a distinctive sentinel prefix. The
sentinel is deliberately chosen so it cannot collide with a category identifier
(billing/pricing/cloudwatch/cloudtrail/inventory) or a Gateway target prefix --
the category name legitimately appears in the response message, but no tool
argument, output, or result value may. If any tool value leaked into the
response, the sentinel would be detected.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any, List, Tuple

from hypothesis import given, settings
from hypothesis import strategies as st

# Make the parent ``agentcore`` directory importable when the test runs from an
# arbitrary working directory (the module under test sits one level up).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from authorization_model import (  # noqa: E402
    ToolCategory,
    build_denial_response,
    is_authorization_denial,
)

# Distinctive marker embedded in every generated tool-data string leaf. Chosen
# (all-caps, with an unusual token) so it cannot appear inside a category
# identifier or target prefix, which makes "this value did not leak into the
# response" a genuine check rather than a vacuous one.
_SENTINEL = "SENTINELTOOLDATA_"

# Gateway target name prefixes per category (mirrors design.md "Tool categories"
# and the runtime helper's category recovery).
_TARGET_PREFIXES = {
    ToolCategory.billing: "billingMcp___",
    ToolCategory.pricing: "pricingMcp___",
    ToolCategory.cloudwatch: "cloudwatchMcp___",
    ToolCategory.cloudtrail: "cloudtrailMcp___",
    ToolCategory.inventory: "inventoryMcp___",
}


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


class _FakeErrorData:
    """Stand-in for ``mcp.shared.exceptions.ErrorData`` (``.message`` / ``.code``)."""

    def __init__(self, message: str, code: int = -32000) -> None:
        self.message = message
        self.code = code


class _FakeMcpError(Exception):
    """Stand-in for ``mcp.shared.exceptions.McpError`` exposing nested error data.

    The runtime's classifier reads ``error.error.message``; this mirrors that
    shape so the test exercises the message-carrying nested-error path.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.error = _FakeErrorData(message=message)


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

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

# Plain identifiers for the echoed-back session/user ids. Restricted to an
# alphabet that cannot contain the sentinel, so they never confound the leak
# check (they are response metadata, not tool data).
_id_text = st.one_of(
    st.none(),
    st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789-", max_size=24),
)

_tool_suffix = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyz_", min_size=1, max_size=20
)


@st.composite
def _denial_error_and_tooldata(draw) -> Tuple[Any, List[str]]:
    """Generate an authorization-denial error plus its embedded tool data.

    Returns ``(error, sentinel_values)`` where ``error`` is one of several
    authorization-denial shapes and ``sentinel_values`` is every sentinel-tagged
    tool-data string that must NOT appear in the response.
    """
    tool_args = draw(_tool_data)
    tool_output = draw(_tool_data)
    tool_result = draw(_tool_data)
    sentinels = (
        _collect_sentinel_values(tool_args)
        + _collect_sentinel_values(tool_output)
        + _collect_sentinel_values(tool_result)
    )

    category = draw(st.sampled_from(list(ToolCategory)))
    tool_name = _TARGET_PREFIXES[category] + draw(_tool_suffix)
    blob = f"args={tool_args!r} output={tool_output!r} result={tool_result!r}"

    shape = draw(
        st.sampled_from(
            [
                "category_enum",
                "category_str",
                "exc_with_target",
                "mcp_error",
                "exc_no_category",
            ]
        )
    )

    if shape == "category_enum":
        # Denied category handed directly to the helper (no tool data attached).
        error: Any = category
    elif shape == "category_str":
        error = category.value
    elif shape == "exc_with_target":
        # AuthorizeActionException naming the target prefix + sentinel tool data.
        error = Exception(
            f"AuthorizeActionException: action '{tool_name}' on resource "
            f"AgentCore::Gateway is not authorized. {blob}"
        )
    elif shape == "mcp_error":
        error = _FakeMcpError(
            f"AuthorizeActionException denied {tool_name}. {blob}"
        )
    else:  # exc_no_category
        # Authorization denial with no recoverable category, still carrying
        # sentinel tool data in its message.
        error = Exception(
            f"AuthorizeActionException: access denied. {blob}"
        )

    return error, sentinels


# ---------------------------------------------------------------------------
# Property 9
# ---------------------------------------------------------------------------

@settings(max_examples=200)
@given(
    payload=_denial_error_and_tooldata(),
    session_id=_id_text,
    user_id=_id_text,
)
def test_denial_response_states_unavailability_and_excludes_tool_data(
    payload: Tuple[Any, List[str]],
    session_id: Any,
    user_id: Any,
) -> None:
    """The denial response states role unavailability and leaks no tool data."""
    error, sentinel_values = payload

    response = build_denial_response(
        error, session_id=session_id, user_id=user_id
    )

    # The response is a dict carrying the denial flag.
    assert isinstance(response, dict)
    assert response.get("denied") is True

    # 1. The user-facing message states the capability is not available for the
    #    user's role.
    message = response["result"]
    assert isinstance(message, str)
    assert re.search(r"not available for your role", message, re.IGNORECASE)

    # Serialize every part of the response that could carry leaked data.
    serialized = "\n".join(
        [
            str(response),
            repr(response),
            str(response.get("result")),
            str(response.get("deniedCategory")),
            str(response.get("sessionId")),
            str(response.get("userId")),
        ]
    )

    # 2. None of the supplied tool data appears anywhere in the response, and
    #    the sentinel marker itself never surfaces.
    for value in sentinel_values:
        assert value not in serialized
    assert _SENTINEL not in serialized


@settings(max_examples=200)
@given(payload=_denial_error_and_tooldata())
def test_generated_errors_are_recognized_as_authorization_denials(
    payload: Tuple[Any, List[str]],
) -> None:
    """Sanity check: every generated exception-shaped input is a denial.

    This guards the meaningfulness of the main property: the exception shapes
    really are classified as authorization denials (rather than slipping through
    as unrelated errors), so the denial response is exercised on a true denial.
    Category-only inputs are not exceptions and are exercised directly by
    ``build_denial_response`` in the main property.
    """
    error, _ = payload
    if isinstance(error, BaseException):
        assert is_authorization_denial(error)
