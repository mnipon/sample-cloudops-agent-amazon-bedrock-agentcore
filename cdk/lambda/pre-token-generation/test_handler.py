"""Example-based unit tests for the Pre Token Generation Lambda handler (Task 3.2).

Feature: gateway-tool-access-control

These are deterministic, example-based unit tests (pytest) for
``handler.handler`` in this directory. They verify that the handler injects the
scalar ``role`` claim derived from the user's verified Cognito group membership
into the issued token(s):

  - A user in ``Administrators`` -> ``role == "admin"`` in BOTH the ID and access
    token claims (V2_0 trigger event).
  - A user in no group (empty list or missing structure) -> ``role == "nonadmin"``.
  - The legacy V1_0 trigger event writes ``role`` into ``claimsOverrideDetails``.

Validates: Requirements 1.1
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Optional

# Make the handler and its vendored ``authorization_model`` importable when the
# test is run from an arbitrary working directory. The modules under test sit in
# this same directory.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import handler  # noqa: E402
from handler import ROLE_CLAIM_NAME  # noqa: E402


# ---------------------------------------------------------------------------
# Event builders mirroring the Cognito Pre Token Generation trigger contract
# ---------------------------------------------------------------------------

def _make_event(
    groups: Optional[List[str]],
    *,
    version: str = "2",
    include_group_config: bool = True,
) -> Dict[str, Any]:
    """Build a Pre Token Generation trigger event.

    Cognito delivers the user's group memberships at
    ``event['request']['groupConfiguration']['groupsToOverride']``.

    Args:
        groups: The list of group names to place in ``groupsToOverride``. Used
            only when ``include_group_config`` is True.
        version: The trigger event version ("1" => ID token only;
            "2"/"3" => ID + access token).
        include_group_config: When False, omit the ``groupConfiguration``
            structure entirely (simulating a missing-structure event).
    """
    request: Dict[str, Any] = {}
    if include_group_config:
        request["groupConfiguration"] = {"groupsToOverride": groups}

    return {
        "version": version,
        "triggerSource": "TokenGeneration_HostedAuth",
        "userName": "test-user",
        "request": request,
        "response": {},
    }


# ---------------------------------------------------------------------------
# V2_0: Administrators member -> role == "admin" in both tokens (Req 1.1)
# ---------------------------------------------------------------------------

def test_v2_administrators_member_emits_admin_in_both_tokens():
    """A user in ``Administrators`` gets ``role="admin"`` in ID and access tokens."""
    event = _make_event(["Administrators"], version="2")

    result = handler.handler(event, None)

    details = result["response"]["claimsAndScopeOverrideDetails"]
    id_claims = details["idTokenGeneration"]["claimsToAddOrOverride"]
    access_claims = details["accessTokenGeneration"]["claimsToAddOrOverride"]

    assert id_claims[ROLE_CLAIM_NAME] == "admin"
    assert access_claims[ROLE_CLAIM_NAME] == "admin"


def test_v2_administrators_member_among_other_groups_emits_admin():
    """``Administrators`` present alongside other groups still yields ``admin``."""
    event = _make_event(["Viewers", "Administrators", "Editors"], version="2")

    result = handler.handler(event, None)

    details = result["response"]["claimsAndScopeOverrideDetails"]
    id_claims = details["idTokenGeneration"]["claimsToAddOrOverride"]
    access_claims = details["accessTokenGeneration"]["claimsToAddOrOverride"]

    assert id_claims[ROLE_CLAIM_NAME] == "admin"
    assert access_claims[ROLE_CLAIM_NAME] == "admin"


# ---------------------------------------------------------------------------
# V2_0: user in no group -> role == "nonadmin" (Req 1.1)
# ---------------------------------------------------------------------------

def test_v2_empty_group_list_emits_nonadmin_in_both_tokens():
    """An empty group list yields ``role="nonadmin"`` in both tokens."""
    event = _make_event([], version="2")

    result = handler.handler(event, None)

    details = result["response"]["claimsAndScopeOverrideDetails"]
    id_claims = details["idTokenGeneration"]["claimsToAddOrOverride"]
    access_claims = details["accessTokenGeneration"]["claimsToAddOrOverride"]

    assert id_claims[ROLE_CLAIM_NAME] == "nonadmin"
    assert access_claims[ROLE_CLAIM_NAME] == "nonadmin"


def test_v2_non_admin_groups_emit_nonadmin():
    """Groups that are not ``Administrators`` yield ``nonadmin``."""
    event = _make_event(["Viewers", "Editors"], version="2")

    result = handler.handler(event, None)

    details = result["response"]["claimsAndScopeOverrideDetails"]
    id_claims = details["idTokenGeneration"]["claimsToAddOrOverride"]
    access_claims = details["accessTokenGeneration"]["claimsToAddOrOverride"]

    assert id_claims[ROLE_CLAIM_NAME] == "nonadmin"
    assert access_claims[ROLE_CLAIM_NAME] == "nonadmin"


def test_v2_missing_group_configuration_emits_nonadmin():
    """A missing ``groupConfiguration`` structure defaults to ``nonadmin``."""
    event = _make_event(None, version="2", include_group_config=False)

    result = handler.handler(event, None)

    details = result["response"]["claimsAndScopeOverrideDetails"]
    id_claims = details["idTokenGeneration"]["claimsToAddOrOverride"]
    access_claims = details["accessTokenGeneration"]["claimsToAddOrOverride"]

    assert id_claims[ROLE_CLAIM_NAME] == "nonadmin"
    assert access_claims[ROLE_CLAIM_NAME] == "nonadmin"


def test_v2_null_groups_to_override_emits_nonadmin():
    """A ``groupsToOverride`` of ``None`` defaults to ``nonadmin``."""
    event = _make_event(None, version="2", include_group_config=True)

    result = handler.handler(event, None)

    details = result["response"]["claimsAndScopeOverrideDetails"]
    id_claims = details["idTokenGeneration"]["claimsToAddOrOverride"]

    assert id_claims[ROLE_CLAIM_NAME] == "nonadmin"


# ---------------------------------------------------------------------------
# V1_0 fallback: role written into claimsOverrideDetails (ID token only)
# ---------------------------------------------------------------------------

def test_v1_administrators_member_writes_claims_override_details():
    """The V1_0 event writes ``role="admin"`` to ``claimsOverrideDetails``."""
    event = _make_event(["Administrators"], version="1")

    result = handler.handler(event, None)

    claims = result["response"]["claimsOverrideDetails"]["claimsToAddOrOverride"]
    assert claims[ROLE_CLAIM_NAME] == "admin"
    # V1 must not carry the V2-only access/ID token override structure.
    assert "claimsAndScopeOverrideDetails" not in result["response"]


def test_v1_no_group_writes_nonadmin():
    """The V1_0 event writes ``role="nonadmin"`` for a user in no group."""
    event = _make_event([], version="1")

    result = handler.handler(event, None)

    claims = result["response"]["claimsOverrideDetails"]["claimsToAddOrOverride"]
    assert claims[ROLE_CLAIM_NAME] == "nonadmin"


# ---------------------------------------------------------------------------
# Handler returns the (mutated) event object per the trigger contract
# ---------------------------------------------------------------------------

def test_handler_returns_event_object():
    """The handler returns the same event object it was given, with response set."""
    event = _make_event(["Administrators"], version="2")

    result = handler.handler(event, None)

    assert result is event
    assert "response" in result
