# Implementation Plan: Inventory MCP Server

## Overview

This plan implements an inventory MCP server that provides tools for querying AWS managed service clusters (EKS, RDS, OpenSearch, ElastiCache, MSK) with version information, operational status, and end-of-support schedules. The implementation covers the MCP server Python source, EOL scraper Lambda, DynamoDB table, CDK infrastructure extensions (Image Stack, MCP Runtime Stack, Gateway Stack, app wiring), buildspec, and agent system prompt updates.

## Tasks

- [x] 1. Create inventory MCP server source structure
  - [x] 1.1 Create `mcp-servers/inventory/` directory with Dockerfile and pyproject.toml
    - Create `mcp-servers/inventory/Dockerfile` with Python base image, EXPOSE 8000, HEALTHCHECK using `curl -sf http://localhost:8000/mcp`, entrypoint running the MCP server
    - Create `mcp-servers/inventory/pyproject.toml` with dependencies: `mcp`, `boto3`, `fastmcp>=2.0.0,<3.0.0`
    - Follow the streamable-http transport pattern used by other MCP servers (host 0.0.0.0, port 8000, stateless_http=True)
    - _Requirements: 1.1, 1.3_

  - [x] 1.2 Create core MCP server module (`src/inventory_mcp_server/`)
    - Create `src/inventory_mcp_server/__init__.py`
    - Create `src/inventory_mcp_server/server.py` — MCP server entry point using `mcp.run(transport='streamable-http', host='0.0.0.0', port=8000, stateless_http=True)`, registers all tools
    - Create `src/inventory_mcp_server/aws_client.py` — helper for creating boto3 clients per region, region discovery via `ec2:DescribeRegions`
    - Create `src/inventory_mcp_server/eol_reader.py` — reads EOL schedule data from DynamoDB with in-memory TTL cache (default 5 min via `EOL_CACHE_TTL` env var)
    - _Requirements: 1.3, 4.5, 4.7_

  - [x] 1.3 Create service tool modules
    - Create `src/inventory_mcp_server/tools/eks.py` — `list_eks_clusters()` tool, queries EKS across all enabled regions, enriches with EOL data
    - Create `src/inventory_mcp_server/tools/rds.py` — `list_rds_instances()` and `list_rds_clusters()` tools, enriches with EOL data for engine versions
    - Create `src/inventory_mcp_server/tools/opensearch.py` — `list_opensearch_domains()` tool, enriches with EOL data
    - Create `src/inventory_mcp_server/tools/elasticache.py` — `list_elasticache_clusters()` tool, enriches with EOL data
    - Create `src/inventory_mcp_server/tools/msk.py` — `list_msk_clusters()` tool, enriches with EOL data
    - Each tool returns structured dicts with name, version, status, arn, region, end_of_standard_support, end_of_extended_support
    - Each tool handles per-region API failures by skipping failed regions and continuing
    - _Requirements: 4.4, 4.5_

- [x] 2. Create EOL scraper Lambda source
  - [x] 2.1 Create `mcp-servers/inventory/eol-scraper/` directory with scraper package
    - Create `mcp-servers/inventory/eol-scraper/eol_scraper/__init__.py`
    - Create `mcp-servers/inventory/eol-scraper/eol_scraper/main.py` — Lambda handler: creates DynamoDB table if not exists, invokes all scrapers, deduplicates by (service, version), writes to DynamoDB via BatchWriteItem
    - Deduplication: use a `seen` set of `(service, version)` tuples before writing
    - _Requirements: 5.1, 5.2, 5.8_

  - [x] 2.2 Create individual service scrapers
    - Create `mcp-servers/inventory/eol-scraper/eol_scraper/scrapers/eks.py` — scrapes EKS version schedules (uses `DescribeClusterVersions` API)
    - Create `mcp-servers/inventory/eol-scraper/eol_scraper/scrapers/rds.py` — scrapes RDS/Aurora engine version schedules
    - Create `mcp-servers/inventory/eol-scraper/eol_scraper/scrapers/elasticache.py` — scrapes ElastiCache version schedules
    - Create `mcp-servers/inventory/eol-scraper/eol_scraper/scrapers/opensearch.py` — scrapes OpenSearch version schedules
    - Create `mcp-servers/inventory/eol-scraper/eol_scraper/scrapers/msk.py` — scrapes MSK version schedules
    - Each scraper returns a list of dicts: `{service, version, end_of_standard_support, end_of_extended_support, status, release_date, source, updated_at}`
    - _Requirements: 5.6, 5.8_

- [x] 3. Checkpoint - Verify MCP server and scraper source
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create buildspec for inventory Docker image
  - [x] 4.1 Create `codebuild-scripts/buildspec-inventory.yml`
    - Use buildspec version 0.2 with three phases: pre_build, build, post_build
    - pre_build: authenticate to ECR using `aws ecr get-login-password`
    - build: `docker build` from the inventory source directory, tag with `$CODEBUILD_BUILD_NUMBER` and `latest`
    - post_build: push both image tags to the ECR repository
    - No transform script required — source is self-contained
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 5. Update Image Stack with inventory ECR repository and CodeBuild project
  - [x] 5.1 Add inventory ECR repository and CodeBuild project to `cdk/lib/image-stack.ts`
    - Create `inventoryMcpRepository` ECR repository named `cloudops-inventory-mcp-runtime` with image scan on push, DESTROY removal policy, empty-on-delete, lifecycle rule keeping 10 images
    - Expose as public readonly property `inventoryMcpRepository`
    - Upload `mcp-servers/inventory/` source to S3 with a new `BucketDeployment`
    - Create CodeBuild project using `buildMainRuntimeImage`-style direct Docker build pattern (not `createTransformBuildProject` since no transform needed)
    - Configure ARM64 architecture, privileged mode, SMALL compute type, 30-minute timeout
    - Create build trigger and build waiter Custom Resources
    - Add CloudFormation output for inventory ECR repository URI
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 6. Update MCP Runtime Stack with inventory runtime and EOL resources
  - [x] 6.1 Extend `MCPRuntimeStackProps` interface in `cdk/lib/mcp-runtime-stack.ts`
    - Add `inventoryMcpRepository: ecr.IRepository` property
    - Add optional `eolTableName?: string` property
    - Add public readonly properties: `inventoryMcpRuntimeArn`, `inventoryMcpRuntimeEndpoint`
    - _Requirements: 8.1_

  - [x] 6.2 Add DynamoDB EOL table (conditional) to `cdk/lib/mcp-runtime-stack.ts`
    - If `eolTableName` prop is provided, use it as the table name without creating a new table
    - If not provided, create a DynamoDB table named `aws-eol-schedules` with PK `service` (String) and SK `version` (String), PAY_PER_REQUEST billing, DESTROY removal policy, point-in-time recovery enabled
    - Store the resolved table name in a local variable for use by runtime and Lambda
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 6.3 Add Inventory MCP Runtime IAM role and runtime resource
    - Create `InventoryMcpRuntimeRole` with `bedrock-agentcore.amazonaws.com` trust principal
    - Grant common runtime permissions (ECR auth token, CloudWatch Logs, Gateway invocation)
    - Grant ECR pull on inventory repository
    - Grant read-only access to EKS, RDS, OpenSearch, ElastiCache, MSK, and EC2 DescribeRegions
    - Grant DynamoDB read access (GetItem, Query, Scan) on the EOL table
    - Create `AWS::BedrockAgentCore::Runtime` named `cloudops_inventory_mcp_jwt_v1` with CustomJWTAuthorizer, PUBLIC network, MCP protocol
    - Set environment variables: `AWS_REGION`, `EOL_TABLE_NAME`, `MCP_TRANSPORT=streamable-http`, `DEPLOYMENT_TIMESTAMP`
    - Add dependency on IAM role, compute and store runtime ARN and endpoint URL
    - Add CloudFormation outputs
    - Add CDK-Nag suppression for IAM wildcard
    - Follow the pattern of `CloudWatchMcpRuntime` / `CloudTrailMcpRuntime`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 6.4 Add EOL Scraper Lambda function with EventBridge schedule
    - Create Lambda function: Python 3.12 runtime, 512 MB memory, 5-minute timeout
    - Package Lambda code from `mcp-servers/inventory/eol-scraper/` directory
    - Set environment variables: `AWS_REGION`, `EOL_TABLE_NAME`
    - Grant IAM permissions: DynamoDB PutItem, BatchWriteItem, CreateTable, DescribeTable on EOL table
    - Grant IAM permissions: EKS DescribeClusterVersions on all resources
    - Create EventBridge rule with `rate(1 day)` schedule targeting the Lambda
    - Add Lambda invoke permission for EventBridge
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 7. Checkpoint - Verify MCP Runtime Stack changes compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update Gateway Stack with inventory target
  - [x] 8.1 Extend `AgentCoreGatewayStackProps` and add inventory gateway target in `cdk/lib/gateway-stack.ts`
    - Add `inventoryMcpRuntimeArn: string` and `inventoryMcpRuntimeEndpoint: string` to props interface
    - Create `InventoryMcpTarget` gateway target named `inventoryMcp` with inventory runtime endpoint
    - Configure OAUTH credential provider with existing OAuth provider ARN and `mcp-runtime-server/invoke` scope
    - Add dependency on Gateway resource
    - Update Gateway `Instructions` to mention inventory alongside billing, pricing, CloudWatch, CloudTrail
    - Follow the pattern of `CloudWatchMcpTarget` / `CloudTrailMcpTarget`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.6_

- [x] 9. Update CDK app entry point
  - [x] 9.1 Update `cdk/bin/app.ts` to wire inventory resources between stacks
    - Read `EOL_TABLE_NAME` from environment variable (or CDK context), following the `COGNITO_ADMIN_EMAIL` pattern
    - Pass `inventoryMcpRepository` from `imageStack` to `MCPRuntimeStack` props
    - Pass `eolTableName` (if set) to `MCPRuntimeStack` props
    - Pass `inventoryMcpRuntimeArn` and `inventoryMcpRuntimeEndpoint` from `mcpRuntimeStack` to `AgentCoreGatewayStack` props
    - _Requirements: 8.3, 8.4, 8.5_

- [x] 10. Update agent system prompt
  - [x] 10.1 Update system prompt in `agentcore/agent_runtime.py`
    - Add inventory capabilities to the tools list: listing clusters across services, checking version end-of-support dates, getting cluster details, querying supported versions
    - Add routing guidance for `inventoryMcp__`-prefixed tools — instruct the agent to use `x_amz_bedrock_agentcore_search` to discover inventory tools when user asks about cluster inventory, version management, or EOL schedules
    - Explain that inventory tools cover EKS, RDS/Aurora, OpenSearch, ElastiCache, and MSK services
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 11. Checkpoint - Verify complete CDK integration compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Property-based tests for data layer logic
  - [x]\* 12.1 Write property test for EOL data round-trip integrity
    - **Property 1: EOL Data Round-Trip Integrity**
    - Generate random service/version/date combos using `hypothesis`, write to mocked DynamoDB, read back via `get_eol_schedule(service)`, verify values match
    - Use `moto` or `unittest.mock` for DynamoDB mocking
    - Minimum 100 iterations
    - **Validates: Requirements 3.3, 5.8**

  - [x]\* 12.2 Write property test for cache consistency within TTL
    - **Property 2: Cache Consistency Within TTL**
    - Generate service names, call `get_eol_schedule(service)` twice within TTL, verify identical result returned without new DynamoDB query (mock should not be called twice)
    - **Validates: Requirements 4.5**

  - [x]\* 12.3 Write property test for multi-region cluster aggregation completeness
    - **Property 3: Multi-Region Cluster Aggregation Completeness**
    - Generate random region→cluster mappings, mock boto3 clients per region, call list tool, verify all regions with clusters are represented and `region` fields match
    - **Validates: Requirements 4.4**

  - [x]\* 12.4 Write property test for EOL enrichment correctness
    - **Property 4: EOL Enrichment Correctness**
    - Generate clusters with versions that may or may not exist in EOL data, verify correct enrichment: matching values when version exists, "Unknown" when it doesn't
    - **Validates: Requirements 4.5, 5.8**

  - [x]\* 12.5 Write property test for scraper deduplication
    - **Property 5: Scraper Deduplication**
    - Generate lists of EOL records with duplicate (service, version) pairs, call `write_to_dynamodb`, verify at most one record per unique key is written
    - **Validates: Requirements 5.8**

- [x] 13. Final checkpoint - Verify all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The inventory MCP server uses Python with `fastmcp` for streamable-http transport, following established MCP server patterns
- CDK infrastructure is TypeScript, following existing patterns in the project
- Property-based tests use `hypothesis` (Python PBT library) with minimum 100 iterations per property
- Tasks marked with `*` are optional and can be skipped for faster MVP
- The inventory MCP server differs from CloudWatch/CloudTrail because it builds directly from local source (no upstream repo clone or transform script)
- The DynamoDB table can be pre-existing (via `EOL_TABLE_NAME` env var) or CDK-created, providing deployment flexibility
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["1.3", "2.2", "4.1"] },
    { "id": 2, "tasks": ["5.1"] },
    { "id": 3, "tasks": ["6.1", "6.2"] },
    { "id": 4, "tasks": ["6.3", "6.4"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["10.1"] },
    { "id": 8, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5"] }
  ]
}
```
