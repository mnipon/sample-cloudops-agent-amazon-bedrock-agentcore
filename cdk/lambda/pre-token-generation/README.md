# Pre Token Generation Lambda

Cognito **Pre Token Generation** trigger for the `gateway-tool-access-control`
feature. It injects a scalar `role` claim (`"admin"` or `"nonadmin"`) into the
user's tokens based on `Administrators` group membership, so the AgentCore
Gateway's Cedar policy can authorize tool access by role.

## Files

- `handler.py` — the Lambda entry point (`handler.handler`). Reads
  `event.request.groupConfiguration.groupsToOverride`, maps it to a scalar role
  claim, and injects `role` into **both** the ID token and the access token
  (V2_0/V3_0 `claimsAndScopeOverrideDetails`), with a V1_0 fallback for the ID
  token only.
- `authorization_model.py` — a **minimal vendored copy** of the role-claim
  mapping (`map_groups_to_role_claim` plus its constants).

## Why the mapping logic is vendored

The authoritative authorization model is
[`agentcore/authorization_model.py`](../../../agentcore/authorization_model.py).
It is the property-tested surface (Property 1 / Requirement 1.1) and the single
source of the role-to-category rules.

This Lambda is packaged as a **self-contained directory asset**
(`lambda.Code.fromAsset(...)`, the same convention as `cdk/lambda/conversations`).
The `agentcore` package lives outside this asset root, so it cannot be imported
at Lambda runtime without introducing a cross-package bundling step. Rather than
add bundling for a four-line pure function, we vendor only the minimal mapping
slice here. The body of `map_groups_to_role_claim` is byte-for-byte identical to
the authoritative implementation so behavior matches the property-tested
surface.

**Keep in sync:** if the authoritative mapping changes, update
`authorization_model.py` in this directory to match. (An alternative, if drift
becomes a concern, is to have the CDK construct copy the authoritative module
into the asset via a bundling step at synth time.)

## Wiring

This trigger is attached to the User Pool in `cdk/lib/auth-stack.ts` (task 3.3).
The User Pool must use a trigger event version that supports access-token
customization (V2_0), which requires the Essentials or Plus feature plan.
