# Requirements Document

## Introduction

This feature integrates a local inventory MCP server into the CloudOps Agent project. The inventory MCP server provides tools for querying EKS, RDS, OpenSearch, ElastiCache, and MSK clusters with version info, status, and end-of-support schedules sourced from a DynamoDB table. Additionally, an EOL scraper Lambda runs on a daily schedule to keep the DynamoDB data current. The deployment follows the existing AgentCore Runtime pattern but differs from CloudWatch/CloudTrail because the server source is local (no upstream repo clone or transform script), a DynamoDB table is involved, and a scheduled Lambda component is required.

## Glossary

- **Inventory_MCP_Server**: A Python-based MCP server that provides tools for querying AWS managed service clusters (EKS, RDS, OpenSearch, ElastiCache, MSK) with version and end-of-support information.
- **EOL_Scraper**: A Python component that scrapes AWS documentation pages and APIs to collect end-of-life/end-of-support schedule data and writes it to DynamoDB.
- **EOL_Table**: A DynamoDB table (partition key: `service`, sort key: `version`) storing end-of-support schedule records for AWS managed services.
- **AgentCore_Runtime**: An AWS Bedrock AgentCore Runtime resource that hosts a containerized MCP server with JWT authorization.
- **Gateway**: The AWS Bedrock AgentCore Gateway that routes tool calls from the main agent to registered MCP server targets.
- **Image_Stack**: The CDK stack responsible for building Docker images via CodeBuild and storing them in ECR.
- **MCP_Runtime_Stack**: The CDK stack that deploys AgentCore Runtime resources with IAM roles and JWT configuration.
- **Gateway_Stack**: The CDK stack that configures the AgentCore Gateway and registers MCP server targets.
- **CDK_App**: The CDK application entry point (`cdk/bin/app.ts`) that wires stacks together.
- **EOL_TABLE_NAME**: An environment variable specifying the DynamoDB table name for EOL schedule data.

## Requirements

### Requirement 1: Inventory MCP Server Source Placement

**User Story:** As a developer, I want the inventory MCP server source placed in a standard project location, so that the project structure remains organized and consistent.

#### Acceptance Criteria

1. THE CDK_App SHALL reference the inventory MCP server source from the `mcp-servers/inventory/` directory within the project root.
2. WHEN the inventory MCP server source is deployed, THE Image_Stack SHALL upload the contents of `mcp-servers/inventory/` to S3 for CodeBuild to build the Docker image.
3. THE `mcp-servers/inventory/` directory SHALL contain the complete Python package source including `pyproject.toml`, `Dockerfile`, and the `src/inventory_mcp_server/` module.

### Requirement 2: Inventory MCP Server ECR Repository and Docker Image Build

**User Story:** As a DevOps engineer, I want the inventory MCP server Docker image built and stored in ECR, so that AgentCore can pull and run the container.

#### Acceptance Criteria

1. THE Image_Stack SHALL create an ECR repository named `cloudops-inventory-mcp-runtime` with image scan on push enabled, DESTROY removal policy, empty-on-delete, and a lifecycle rule keeping the last 10 images.
2. THE Image_Stack SHALL expose the inventory ECR repository as a public readonly property.
3. THE Image_Stack SHALL create a CodeBuild project that builds the Docker image directly from the inventory MCP server source directory without any transform script.
4. THE Image_Stack SHALL configure the CodeBuild project with ARM64 architecture, privileged mode, SMALL compute type, and a 30-minute timeout.
5. THE Image_Stack SHALL create a build trigger Custom Resource and a build waiter Custom Resource that ensure the image is built during CDK deployment.
6. THE Image_Stack SHALL output the inventory ECR repository URI as a CloudFormation output.

### Requirement 3: DynamoDB EOL Table Configuration

**User Story:** As a deployer, I want the option to either provide an existing DynamoDB table name or have the CDK create one automatically, so that the deployment is flexible across environments.

#### Acceptance Criteria

1. WHEN the `EOL_TABLE_NAME` environment variable is set before deployment, THE MCP_Runtime_Stack SHALL use the provided table name and pass it to the inventory runtime as an environment variable without creating a new DynamoDB table.
2. WHEN the `EOL_TABLE_NAME` environment variable is not set, THE MCP_Runtime_Stack SHALL create a new DynamoDB table named `aws-eol-schedules` with partition key `service` (String) and sort key `version` (String), using PAY_PER_REQUEST billing mode.
3. THE MCP_Runtime_Stack SHALL pass the resolved EOL table name to both the Inventory_MCP_Server runtime and the EOL_Scraper Lambda as an environment variable.
4. WHEN the CDK creates the DynamoDB table, THE MCP_Runtime_Stack SHALL configure the table with DESTROY removal policy for clean teardown.
5. WHEN the CDK creates the DynamoDB table, THE MCP_Runtime_Stack SHALL enable point-in-time recovery on the table.

### Requirement 4: Inventory MCP Server AgentCore Runtime Deployment

**User Story:** As a platform engineer, I want the inventory MCP server deployed as an AgentCore Runtime with proper IAM permissions, so that it can query AWS services and read EOL data securely.

#### Acceptance Criteria

1. THE MCP_Runtime_Stack SHALL create an IAM role for the inventory runtime with `bedrock-agentcore.amazonaws.com` as the trusted service principal.
2. THE MCP_Runtime_Stack SHALL grant the inventory runtime role common AgentCore permissions: ECR authorization token, CloudWatch Logs (create log group, create log stream, put log events), and Gateway invocation.
3. THE MCP_Runtime_Stack SHALL grant the inventory runtime role ECR pull access on the inventory ECR repository.
4. THE MCP_Runtime_Stack SHALL grant the inventory runtime role read-only access to EKS (ListClusters, DescribeClusters, ListNodegroups, ListAddons, DescribeClusterVersions), RDS (DescribeDBInstances, DescribeDBClusters, DescribeDBEngineVersions), OpenSearch (ListDomainNames, DescribeDomains, DescribeDomain), ElastiCache (DescribeCacheClusters, DescribeReplicationGroups), MSK (ListClustersV2, DescribeClusterV2), and EC2 (DescribeRegions).
5. THE MCP_Runtime_Stack SHALL grant the inventory runtime role DynamoDB read access (GetItem, Query, Scan) on the EOL table.
6. THE MCP_Runtime_Stack SHALL create an `AWS::BedrockAgentCore::Runtime` resource named `cloudops_inventory_mcp_jwt_v1` with CustomJWTAuthorizer configuration, PUBLIC network mode, and MCP protocol.
7. THE MCP_Runtime_Stack SHALL set environment variables on the inventory runtime: `AWS_REGION`, `EOL_TABLE_NAME`, `MCP_TRANSPORT=streamable-http`, and `DEPLOYMENT_TIMESTAMP`.
8. THE MCP_Runtime_Stack SHALL compute and expose the inventory runtime ARN and endpoint URL as public readonly properties and CloudFormation outputs.

### Requirement 5: EOL Scraper Lambda Deployment

**User Story:** As a platform engineer, I want the EOL scraper deployed as a scheduled Lambda function, so that end-of-support data is refreshed daily without manual intervention.

#### Acceptance Criteria

1. THE MCP_Runtime_Stack SHALL create a Lambda function for the EOL scraper with Python 3.12 runtime, 512 MB memory, and 5-minute timeout.
2. THE MCP_Runtime_Stack SHALL package the EOL scraper Lambda from the `mcp-servers/inventory/eol-scraper/` directory.
3. THE MCP_Runtime_Stack SHALL create an EventBridge rule that triggers the EOL scraper Lambda once daily.
4. THE MCP_Runtime_Stack SHALL set environment variables on the Lambda: `AWS_REGION`, `EOL_TABLE_NAME`.
5. THE MCP_Runtime_Stack SHALL grant the EOL scraper Lambda IAM permissions for DynamoDB write access (PutItem, BatchWriteItem, CreateTable, DescribeTable) on the EOL table.
6. THE MCP_Runtime_Stack SHALL grant the EOL scraper Lambda IAM permissions for EKS DescribeClusterVersions in all regions.
7. THE MCP_Runtime_Stack SHALL grant the EOL scraper Lambda outbound internet access for scraping AWS documentation pages.
8. WHEN the EOL scraper Lambda is invoked, THE EOL_Scraper SHALL create the DynamoDB table if it does not already exist, then scrape and write EOL schedule data for EKS, RDS, ElastiCache, OpenSearch, and MSK.

### Requirement 6: Gateway Target Registration

**User Story:** As a platform engineer, I want the inventory MCP server registered as a Gateway target, so that the main agent can discover and invoke inventory tools through the Gateway.

#### Acceptance Criteria

1. THE Gateway_Stack SHALL accept the inventory runtime ARN and endpoint as input properties.
2. THE Gateway_Stack SHALL create an `AWS::BedrockAgentCore::GatewayTarget` resource named `inventoryMcp` with the inventory runtime endpoint.
3. THE Gateway_Stack SHALL configure the inventory target with OAUTH credential provider using the existing OAuth provider ARN and `mcp-runtime-server/invoke` scope.
4. THE Gateway_Stack SHALL add a dependency on the Gateway resource to ensure correct deployment ordering.

### Requirement 7: Agent System Prompt Update

**User Story:** As an end user, I want the CloudOps agent to know about inventory tools, so that I can ask questions about my EKS, RDS, OpenSearch, ElastiCache, and MSK clusters and their version support status.

#### Acceptance Criteria

1. THE system prompt in `agentcore/agent_runtime.py` SHALL list inventory capabilities: listing clusters across services, checking version end-of-support dates, getting cluster details, and querying supported versions.
2. THE system prompt SHALL include routing guidance for `inventoryMcp__`-prefixed tools, instructing the agent to use `x_amz_bedrock_agentcore_search` to discover inventory tools when the user asks about cluster inventory, version management, or end-of-support schedules.
3. THE system prompt SHALL explain that inventory tools cover EKS, RDS/Aurora, OpenSearch, ElastiCache, and MSK services.

### Requirement 8: CDK Stack Interface and Wiring

**User Story:** As a developer, I want the CDK stacks properly wired to pass inventory runtime information between stacks, so that the deployment works end-to-end.

#### Acceptance Criteria

1. THE `MCPRuntimeStackProps` interface SHALL include an `inventoryMcpRepository: ecr.IRepository` property.
2. THE `AgentCoreGatewayStackProps` interface SHALL include `inventoryMcpRuntimeArn` and `inventoryMcpRuntimeEndpoint` string properties.
3. THE CDK_App SHALL pass the inventory ECR repository from Image_Stack to MCP_Runtime_Stack.
4. THE CDK_App SHALL pass the inventory runtime ARN and endpoint from MCP_Runtime_Stack to Gateway_Stack.
5. THE CDK_App SHALL read the `EOL_TABLE_NAME` environment variable (or CDK context) and pass it to MCP_Runtime_Stack, following the same optional-configuration pattern as `COGNITO_ADMIN_EMAIL`.
6. THE Gateway_Stack description and Gateway instructions SHALL mention inventory tools alongside existing billing, pricing, CloudWatch, and CloudTrail tools.

### Requirement 9: Inventory MCP Server Buildspec

**User Story:** As a DevOps engineer, I want a buildspec that builds the inventory Docker image directly from source, so that CodeBuild can produce the container image without transform scripts.

#### Acceptance Criteria

1. THE buildspec SHALL use version 0.2 with three phases: pre_build, build, post_build.
2. WHEN the pre_build phase executes, THE buildspec SHALL authenticate to ECR using `aws ecr get-login-password`.
3. WHEN the build phase executes, THE buildspec SHALL run `docker build` on the inventory MCP server source directory, tagging with both `$CODEBUILD_BUILD_NUMBER` and `latest`.
4. WHEN the post_build phase executes, THE buildspec SHALL push both image tags to the ECR repository.
5. THE buildspec SHALL NOT reference any transform script since the inventory MCP server source is self-contained.
