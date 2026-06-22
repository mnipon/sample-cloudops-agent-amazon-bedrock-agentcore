"""Example-based unit tests for authorization model edge cases (Task 1.10).

Feature: gateway-tool-access-control

These are deterministic, example-based unit tests (pytest) that complement the
property-based tests. They pin down the specific edge cases called out in the
design's Testing Strategy:

  - ``derive_role`` case sensitivity and absent-claim handling
  - ``map_groups_to_role_claim`` for an Administrators member and a no-group user
  - ``build_deny_audit_entry`` producing exactly the four required fields

Validates: Requirements 1.2, 1.3, 1.4, 8.3
"""

from __future__ import annotations

import os
import sys

# Make the parent ``agentcore`` package importable when the test is run from an
# arbitrary working directory (the module under test sits one level up).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from authorization_model import (  # noqa: E402
    DENY_OUTCOME,
    Role,
    build_deny_audit_entry,
    derive_role,
    map_groups_to_role_claim,
)


# ---------------------------------------------------------------------------
# derive_role edge cases (Req 1.2, 1.3, 1.4)
# ---------------------------------------------------------------------------

def test_derive_role_exact_admin_is_admin():
    """The exact claim ``"admin"`` resolves to ``Role.Admin``. (Req 1.2)"""
    assert derive_role("admin") is Role.Admin


def test_derive_role_is_case_sensitive():
    """A different-case claim ``"Admin"`` does NOT match and is NonAdmin. (Req 1.3)"""
    assert derive_role("Admin") is Role.NonAdmin


def test_derive_role_absent_claim_is_nonadmin():
    """An absent claim (``None``) defaults to ``Role.NonAdmin``. (Req 1.4)"""
    assert derive_role(None) is Role.NonAdmin


# ---------------------------------------------------------------------------
# map_groups_to_role_claim edge cases (Req 1.1)
# ---------------------------------------------------------------------------

def test_map_groups_administrators_member_is_admin_claim():
    """A user in ``Administrators`` maps to the scalar claim ``"admin"``."""
    assert map_groups_to_role_claim(["Administrators"]) == "admin"


def test_map_groups_no_group_is_nonadmin_claim():
    """A user in no group maps to the scalar claim ``"nonadmin"``."""
    assert map_groups_to_role_claim([]) == "nonadmin"


# ---------------------------------------------------------------------------
# build_deny_audit_entry produces the four required fields (Req 8.3)
# ---------------------------------------------------------------------------

def test_build_deny_audit_entry_has_exactly_four_fields():
    """The audit entry's ``to_dict`` yields exactly the four required fields.

    The four fields are: the identity reference, the requested category, the
    fixed ``"deny"`` outcome, and the decision timestamp. (Req 8.3)
    """
    entry = build_deny_audit_entry(
        identity_ref="user-sub-123",
        category="cloudwatch",
        timestamp="2024-01-01T00:00:00Z",
    )

    record = entry.to_dict()

    assert set(record.keys()) == {"identityRef", "category", "outcome", "timestamp"}
    assert record["identityRef"] == "user-sub-123"
    assert record["category"] == "cloudwatch"
    assert record["outcome"] == DENY_OUTCOME
    assert record["outcome"] == "deny"
    assert record["timestamp"] == "2024-01-01T00:00:00Z"
