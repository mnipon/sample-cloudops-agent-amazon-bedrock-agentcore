# Deny-Audit Interceptor Lambda

Gateway **REQUEST interceptor** for the `gateway-tool-access-control` feature.
It emits exactly one structured CloudWatch record whenever a Tool_Invocation
(`tools/call`) would be denied for the caller's role, satisfying the structured
deny-audit requirement (Req 8.3) without ever logging token values or tool
arguments/results.

## Files

- `handler.py` — the Lambda entry point (`handler.handler`). A REQUEST
  interceptor that audits and passes the request through unchanged.
- `authorization_model.py` — a vendored byte-for-byte copy of the authoritative
  model (`agentcore/authorization_model.py`), used to re-derive the role and the
  authorization decision so behavior matches the property-tested surface.

## What was verified (AgentCore API research)

The implementation is grounded in the AgentCore docs, not guesswork:

1. **Gateway interceptors are a real, verifiable mechanism.**
   `AWS::BedrockAgentCore::Gateway` has an `InterceptorConfigurations` property
   (array, 1–2 entries). Each `GatewayInterceptorConfiguration` has:
   - `InterceptionPoints` — array of `REQUEST` / `RESPONSE` (max 2),
   - `Interceptor.Lambda.Arn` — the interceptor Lambda ARN,
   - `InputConfiguration.PassRequestHeaders` — required boolean.
     A gateway may have at most one REQUEST and one RESPONSE interceptor; only
     Lambda interceptors are supported.
     (CloudFormation `AWS::BedrockAgentCore::Gateway` reference; devguide
     _Using interceptors with Gateway_.)

2. **REQUEST interceptor payload (MCP target).**
   `event.mcp.gatewayRequest.body` is the JSON-RPC request
   (`{method, params:{name, arguments}}`). `event.mcp.gatewayRequest.headers`
   (including `Authorization`) is delivered **only** when `passRequestHeaders`
   is `true`. There is no separate decoded-principal field — the JWT `sub` is
   obtainable only by decoding the bearer token. The Gateway has already
   verified the JWT before the interceptor runs, so the handler decodes (does
   not verify) the payload purely to read `sub` and `role`, and never logs the
   token.

3. **AgentCore Policy already has native deny observability.** Policy/Policy
   Engine emit allow/deny decision metrics to the `AWS/Bedrock-AgentCore`
   CloudWatch namespace, plus structured authorization-decision span data when
   traces are enabled on the Gateway. The design (Note 4) permits omitting the
   interceptor when native observability provides an equivalent record. We chose
   to implement the **interceptor** as the single canonical audit entry because
   the task explicitly calls for it and it lets us emit precisely the four
   mandated fields (`identityRef`, `category`, `outcome="deny"`, `timestamp`)
   as one structured record. We deliberately do **not** also enable a competing
   native-observability audit sink, to keep "exactly one audit entry" per deny
   (Req 8.3).

## Design choice: audit-only, pass-through

The authoritative authorization layer is the Gateway's Cedar **Policy** engine
(`gateway-stack.ts`, task 4.2) — it is what actually denies and returns the
`AuthorizeActionException`. This interceptor:

- inspects the `tools/call` request, re-derives the decision with the **same**
  authoritative role→category model, and emits one structured record on a
  computed deny;
- **always** forwards the request unchanged (never returns a
  `transformedGatewayResponse`), so it never enforces, short-circuits, or
  mutates the authoritative decision.

This makes **Req 8.4** hold by construction: the entire audit step is wrapped so
any failure (missing/garbled `Authorization` header, undecodable token, logging
error) is swallowed and the request is still forwarded unchanged. Because Cedar
Policy produces the deny independently, an audit-record failure can never
suppress the authorization error returned to the caller.

> Ordering note: the relative order of the REQUEST interceptor vs. Cedar
> evaluation is not contractually documented. The interceptor does not depend on
> observing Cedar's decision — it computes the decision itself from the verified
> JWT claims and the requested category — so it audits correctly regardless of
> ordering, as long as the REQUEST interceptor runs for the request. The
> end-to-end "exactly one record per deny" behavior against the live service is
> covered by the integration test (task 9.7).

## Security

- `passRequestHeaders` is set to `true` so the handler can read `Authorization`
  to recover the JWT `sub`/`role`. The handler decodes the payload locally and
  logs **only** the four audit fields — never the token, the `Authorization`
  header, or any decode-error text.
- The gateway service role is granted `lambda:InvokeFunction` scoped to this
  function ARN only (per the interceptor security best practices), not a
  wildcard.

## Wiring

Registered on the Gateway via `InterceptorConfigurations` in
`cdk/lib/gateway-stack.ts` (task 4.3). The Lambda writes to a dedicated
CloudWatch Log Group provisioned in the same stack.

## Keep in sync

`authorization_model.py` here is a vendored copy of
[`agentcore/authorization_model.py`](../../../agentcore/authorization_model.py)
(the property-tested surface). If the authoritative model changes, update this
copy to match.
