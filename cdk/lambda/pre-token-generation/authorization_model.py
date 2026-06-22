"""
Vendored (minimal) copy of the role-claim mapping logic.

AUTHORITATIVE SOURCE: ``agentcore/authorization_model.py``

This file is a deliberately minimal mirror of ONLY the claim-mapping slice that
the Cognito Pre Token Generation Lambda needs (the ``Administrators`` group
constant, the two scalar claim constants, and ``map_groups_to_role_claim``).

WHY THIS IS VENDORED
--------------------
The authoritative model lives in ``agentcore/authorization_model.py`` and is the
property-tested surface for the gateway-tool-access-control feature. However,
this CDK Lambda is packaged as a self-contained directory asset
(``lambda.Code.fromAsset(...)``, the same convention used by
``cdk/lambda/conversations``), and the ``agentcore`` package is outside this
asset root, so it cannot be imported at Lambda runtime. Rather than introduce a
cross-package bundling step for a four-line function, we vendor the minimal
slice here.

KEEP IN SYNC
------------
The body of ``map_groups_to_role_claim`` below is byte-for-byte identical to the
authoritative implementation so the Lambda's behavior matches the
property-tested surface (Property 1 / Requirement 1.1). If the authoritative
mapping changes, update this copy to match.

Feature: gateway-tool-access-control
"""

from __future__ import annotations

from typing import Iterable, Optional


# Cognito group whose membership designates the Admin role.
ADMIN_GROUP: str = "Administrators"

# The scalar `role` claim values injected into the user's token. These are the
# only two values `map_groups_to_role_claim` may ever return.
ADMIN_CLAIM: str = "admin"
NONADMIN_CLAIM: str = "nonadmin"


def map_groups_to_role_claim(groups: Optional[Iterable[str]]) -> str:
    """Map a user's Cognito group memberships to a single scalar role claim.

    Returns exactly one value in ``{"admin", "nonadmin"}``. The result is
    ``"admin"`` if and only if the ``Administrators`` group is present in
    ``groups``; otherwise it is ``"nonadmin"``.

    The mapping is intentionally tolerant of how ``cognito:groups`` may arrive:
    a missing claim (``None``), an empty collection, or any collection of
    group-name strings. Non-string members are ignored. (Req 1.1)

    Args:
        groups: The user's group memberships (e.g. the ``cognito:groups``
            claim), or ``None`` if absent.

    Returns:
        ``"admin"`` if the user belongs to ``Administrators``, else
        ``"nonadmin"``.
    """
    if groups is None:
        return NONADMIN_CLAIM

    for group in groups:
        if group == ADMIN_GROUP:
            return ADMIN_CLAIM

    return NONADMIN_CLAIM
