# Implementation Plan: CloudWatch & CloudTrail MCP Servers

## Overview

This plan extends the CloudOps Agent with two new MCP servers (CloudWatch and CloudTrail) following the established patterns for billing and pricing MCP servers. Implementation covers transform scripts, buildspec files, CDK stack modifications (Image Stack, MCP Runtime Stack, Gateway Stack, app entry point), and agent system prompt updates.

## Tasks

- [x] 1. Create CloudWatch and CloudTrail transform scripts
  - [x] 1.1 Create `codebuild-scripts/transform-cloudwatch.sh`
    - Clone `https://github.com/awslabs/mcp.git` with `--depth 1`
    - Navigate to `src/cloudwatch-logs-mcp-server`
    - Patch server entry point to use `mcp.run(transport='streamable-http', host='0.0.0.0', port=8000, stateless_http=True)`
    - Add `fastmcp>=2.0.0,<3.0.0` to `pyproject.toml` and regenerate `uv.lock`
    - Patch Dockerfile: remove `UV_FROZEN`/`--frozen`, add `EXPOSE 8000`, update entrypoint
    - Replace `docker-healthcheck.sh` with `curl -sf http://localhost:8000/mcp`
    - Add grep validation assertions for `streamable-http`, `port=8000`, `fastmcp`, `EXPOSE 8000`
    - Exit non-zero on any validation failure
    - Follow the pattern established in `transform-billing.sh` and `transform-pricing.sh`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 1.2 Create `codebuild-scripts/transform-cloudtrail.sh`
    - Clone `https://github.com/awslabs/mcp.git` with `--depth 1`
    - Navigate to `src/cloudtrail-mcp-server`
    - Patch server entry point to use `mcp.run(transport='streamable-http', host='0.0.0.0', port=8000, stateless_http=True)`
    - Add `fastmcp>=2.0.0,<3.0.0` to `pyproject.toml` and regenerate `uv.lock`
    - Patch Dockerfile: remove `UV_FROZEN`/`--frozen`, add `EXPOSE 8000`, update entrypoint
    - Replace `docker-healthcheck.sh` with `curl -sf http://localhost:8000/mcp`
    - Add grep validation assertions for `streamable-http`, `port=8000`, `fastmcp`, `EXPOSE 8000`
    - Exit non-zero on any validation failure
    - Follow the pattern established in `transform-billing.sh` and `transform-pricing.sh`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 2. Create CloudWatch and CloudTrail buildspec files
  - [x] 2.1 Create `codebuild-scripts/buildspec-cloudwatch.yml`
    - Use buildspec version 0.2 with three phases: pre_build, build, post_build
    - pre_build: make `transform-cloudwatch.sh` executable, run it, authenticate to ECR
    - build: `cd` to `mcp/src/cloudwatch-logs-mcp-server`, `docker build` with `$ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER`, tag as `latest`
    - post_build: push both image tags to ECR
    - Follow the pattern in `buildspec-billing.yml`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 2.2 Create `codebuild-scripts/buildspec-cloudtrail.yml`
    - Use buildspec version 0.2 with three phases: pre_build, build, post_build
    - pre_build: make `transform-cloudtrail.sh` executable, run it, authenticate to ECR
    - build: `cd` to `mcp/src/cloudtrail-mcp-server`, `docker build` with `$ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER`, tag as `latest`
    - post_build: push both image tags to ECR
    - Follow the pattern in `buildspec-billing.yml`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 3. Checkpoint - Verify scripts and buildspecs
  - Ensure all transform scripts and buildspec files follow the established patterns, ask the user if questions arise.

- [x] 4. Update Image Stack with CloudWatch and CloudTrail ECR repositories and CodeBuild projects
  - [x] 4.1 Add CloudWatch and CloudTrail ECR repositories to `cdk/lib/image-stack.ts`
    - Create `cloudwatchMcpRepository` ECR repository named `cloudops-cloudwatch-mcp-runtime`
    - Create `cloudtrailMcpRepository` ECR repository named `cloudops-cloudtrail-mcp-runtime`
    - Both with image scan on push, DESTROY removal policy, empty-on-delete, lifecycle rule keeping 10 images
    - Expose as public readonly properties
    - Add CloudFormation outputs for repository URIs
    - Follow the pattern of `billingMcpRepository` and `pricingMcpRepository`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

  - [x] 4.2 Add CloudWatch and CloudTrail CodeBuild projects to `cdk/lib/image-stack.ts`
    - Create CodeBuild project `cloudops-cloudwatchmcp-build` using `buildspec-cloudwatch.yml`
    - Create CodeBuild project `cloudops-cloudtrailmcp-build` using `buildspec-cloudtrail.yml`
    - Both with ARM64 AL2 Standard 3.0, SMALL compute, privileged mode, 30-minute timeout
    - Environment variables: `AWS_DEFAULT_REGION`, `AWS_ACCOUNT_ID`, `ECR_REPO_URI`
    - Grant IAM permissions for ECR push, S3 read, CloudWatch Logs
    - Add build trigger and build waiter Custom Resources for each project
    - Add dependency on `scriptsDeployment` for CodeBuild projects
    - Reuse existing `buildTriggerFn` and `buildWaiterFn` Lambda functions
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 5. Update MCP Runtime Stack with CloudWatch and CloudTrail runtimes
  - [x] 5.1 Extend `MCPRuntimeStackProps` interface in `cdk/lib/mcp-runtime-stack.ts`
    - Add `cloudwatchMcpRepository: ecr.IRepository` property
    - Add `cloudtrailMcpRepository: ecr.IRepository` property
    - Add public readonly properties for runtime ARNs and endpoints
    - _Requirements: 14.1, 14.2_

  - [x] 5.2 Add CloudWatch MCP Runtime IAM role and runtime resource
    - Create `CloudWatchMcpRuntimeRole` with `bedrock-agentcore.amazonaws.com` trust
    - Grant common runtime permissions (ECR auth, CloudWatch Logs, Gateway invocation)
    - Grant `cloudwatch:*` and `logs:*` on all resources
    - Grant ECR pull on CloudWatch repository
    - Create `AWS::BedrockAgentCore::Runtime` named `cloudops_cloudwatch_mcp_jwt_v1`
    - Configure CustomJWTAuthorizer with Cognito OIDC discovery URL and M2M client ID
    - Configure PUBLIC network mode and MCP protocol
    - Set environment variables: `AWS_REGION`, `DEPLOYMENT_TIMESTAMP`
    - Add dependency on IAM role
    - Compute and store runtime endpoint URL
    - Add CloudFormation outputs for ARN and endpoint
    - Follow the pattern of `BillingMcpRuntime`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 5.3 Add CloudTrail MCP Runtime IAM role and runtime resource
    - Create `CloudTrailMcpRuntimeRole` with `bedrock-agentcore.amazonaws.com` trust
    - Grant common runtime permissions (ECR auth, CloudWatch Logs, Gateway invocation)
    - Grant `cloudtrail:LookupEvents`, `cloudtrail:GetTrailStatus`, `cloudtrail:DescribeTrails`, `cloudtrail:GetEventSelectors`, `cloudtrail:ListTrails`
    - Grant ECR pull on CloudTrail repository
    - Create `AWS::BedrockAgentCore::Runtime` named `cloudops_cloudtrail_mcp_jwt_v1`
    - Configure CustomJWTAuthorizer with Cognito OIDC discovery URL and M2M client ID
    - Configure PUBLIC network mode and MCP protocol
    - Set environment variables: `AWS_REGION`, `DEPLOYMENT_TIMESTAMP`
    - Add dependency on IAM role
    - Compute and store runtime endpoint URL
    - Add CloudFormation outputs for ARN and endpoint
    - Follow the pattern of `PricingMcpRuntime`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x] 6. Checkpoint - Verify MCP Runtime Stack changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update Gateway Stack with CloudWatch and CloudTrail targets
  - [x] 7.1 Extend `AgentCoreGatewayStackProps` and add gateway targets in `cdk/lib/gateway-stack.ts`
    - Add `cloudwatchMcpRuntimeArn`, `cloudwatchMcpRuntimeEndpoint` properties
    - Add `cloudtrailMcpRuntimeArn`, `cloudtrailMcpRuntimeEndpoint` properties
    - Create `CloudWatchMcpTarget` gateway target named `cloudwatchMcp`
    - Create `CloudTrailMcpTarget` gateway target named `cloudtrailMcp`
    - Both targets: OAUTH credential provider with OAuth provider ARN and `mcp-runtime-server/invoke` scope
    - Both targets: dependency on Gateway resource
    - Follow the pattern of `BillingMcpTarget` and `PricingMcpTarget`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 14.3, 14.6_

- [x] 8. Update CDK app entry point
  - [x] 8.1 Update `cdk/bin/app.ts` to pass new repositories and runtime endpoints between stacks
    - Pass `cloudwatchMcpRepository` and `cloudtrailMcpRepository` from `imageStack` to `MCPRuntimeStack`
    - Pass `cloudwatchMcpRuntimeArn`, `cloudwatchMcpRuntimeEndpoint`, `cloudtrailMcpRuntimeArn`, `cloudtrailMcpRuntimeEndpoint` from `mcpRuntimeStack` to `AgentCoreGatewayStack`
    - Existing `addDependency` calls already enforce the correct ordering
    - _Requirements: 14.4, 14.5_

- [x] 9. Update agent system prompt
  - [x] 9.1 Update system prompt in `agentcore/agent_runtime.py`
    - Add CloudWatch capabilities to the tools list: metrics queries, alarm status, log groups, log insights
    - Add CloudTrail capabilities to the tools list: event history lookup, trail status, API activity investigation
    - Add routing guidance for `cloudwatchMcp__`-prefixed tools (operational health, monitoring, log investigation)
    - Add routing guidance for `cloudtrailMcp__`-prefixed tools (who did what, resource changes, account auditing)
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 10. Final checkpoint - Verify complete integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This feature consists entirely of Infrastructure as Code (CDK/TypeScript), shell scripts, and YAML configurations
- Property-based tests are not applicable; correctness is verified through CDK snapshot tests and script validation assertions
- All new resources follow the established patterns from billing and pricing MCP servers
- The deployment ordering chain `ImageStack → AuthStack → MCPRuntimeStack → GatewayStack → AgentRuntimeStack` is enforced by existing `addDependency` calls
- Transform scripts must exit non-zero on validation failure to trigger CloudFormation rollback
- Each task references specific requirement acceptance criteria for traceability

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2"] },
    { "id": 1, "tasks": ["4.1"] },
    { "id": 2, "tasks": ["4.2", "5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["9.1"] }
  ]
}
```
