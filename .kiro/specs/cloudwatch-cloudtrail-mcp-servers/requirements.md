# Requirements Document

## Introduction

This feature extends the existing CloudOps Agent by adding two new MCP (Model Context Protocol) servers — AWS CloudWatch and AWS CloudTrail — deployable to Amazon Bedrock AgentCore Runtime and accessible via the existing AgentCore Gateway. These servers follow the same stdio-to-HTTP transformation, Docker containerization, and deployment patterns established by the billing and pricing MCP servers. The CloudWatch MCP server enables the agent to query metrics, alarms, and logs. The CloudTrail MCP server enables the agent to query API activity, event history, and trail configuration.

## Glossary

- **MCP_Server**: A Model Context Protocol server that exposes tools for AI agent invocation, running as a containerized HTTP service on AgentCore Runtime
- **AgentCore_Runtime**: Amazon Bedrock AgentCore Runtime, which hosts containerized MCP servers with JWT authorization
- **AgentCore_Gateway**: Amazon Bedrock AgentCore Gateway, which provides unified tool discovery and invocation routing to registered MCP server targets
- **CloudWatch_MCP_Server**: The new MCP server providing tools for querying AWS CloudWatch metrics, alarms, log groups, and log insights
- **CloudTrail_MCP_Server**: The new MCP server providing tools for querying AWS CloudTrail events, trails, and API activity history
- **Transform_Script**: A shell script that clones the upstream AWS Labs MCP repository, patches the server for streamable-http transport, and prepares it for Docker build
- **Buildspec**: A CodeBuild build specification YAML file that orchestrates the transformation, Docker image build, and ECR push
- **ECR_Repository**: An Amazon Elastic Container Registry repository storing the Docker image for an MCP server
- **Gateway_Target**: A registered endpoint within the AgentCore Gateway that routes tool invocations to a specific MCP server runtime
- **Image_Stack**: The CDK stack responsible for ECR repositories, CodeBuild projects, and Docker image builds
- **MCP_Runtime_Stack**: The CDK stack responsible for deploying AgentCore Runtimes with IAM roles and JWT authorization
- **Gateway_Stack**: The CDK stack responsible for the AgentCore Gateway and its registered targets

## Requirements

### Requirement 1: CloudWatch MCP Server ECR Repository

**User Story:** As a platform engineer, I want a dedicated ECR repository for the CloudWatch MCP server image, so that the container image can be stored and versioned independently.

#### Acceptance Criteria

1. THE Image_Stack SHALL create an ECR repository named `cloudops-cloudwatch-mcp-runtime` with image scan on push enabled
2. THE Image_Stack SHALL configure the CloudWatch ECR repository with a lifecycle rule that retains the most recent 10 images by push date and removes all older images
3. THE Image_Stack SHALL configure the CloudWatch ECR repository with a DESTROY removal policy and empty-on-delete enabled
4. THE Image_Stack SHALL expose the CloudWatch ECR repository as a public stack property and output its repository URI as a CloudFormation stack export

### Requirement 2: CloudTrail MCP Server ECR Repository

**User Story:** As a platform engineer, I want a dedicated ECR repository for the CloudTrail MCP server image, so that the container image can be stored and versioned independently.

#### Acceptance Criteria

1. THE Image_Stack SHALL create an ECR repository named `cloudops-cloudtrail-mcp-runtime` with image scan on push enabled and image tag mutability set to MUTABLE
2. THE Image_Stack SHALL configure the CloudTrail ECR repository with a lifecycle rule that retains the last 10 images and removes older images regardless of tag status
3. THE Image_Stack SHALL configure the CloudTrail ECR repository with a DESTROY removal policy and empty-on-delete enabled to allow clean teardown of the stack
4. THE Image_Stack SHALL expose the CloudTrail ECR repository URI as a stack output and as a public readonly property so that downstream stacks can reference it for image push and pull operations

### Requirement 3: CloudWatch MCP Server Transformation Script

**User Story:** As a platform engineer, I want a transformation script that patches the upstream CloudWatch MCP server for streamable-http transport, so that it can run as an HTTP service on AgentCore Runtime.

#### Acceptance Criteria

1. THE Transform_Script SHALL clone the upstream AWS Labs MCP repository from `https://github.com/awslabs/mcp.git` using a shallow clone with depth 1
2. THE Transform_Script SHALL navigate to the `src/cloudwatch-logs-mcp-server` directory within the cloned repository
3. THE Transform_Script SHALL patch the server entry point `main()` function to call `mcp.run()` with `transport='streamable-http'`, `host='0.0.0.0'`, `port=8000`, and `stateless_http=True`
4. THE Transform_Script SHALL add the `fastmcp` dependency with version constraint `>=2.0.0,<3.0.0` to the project's `pyproject.toml` and regenerate the lockfile
5. THE Transform_Script SHALL patch the Dockerfile to expose port 8000, remove any UV_FROZEN environment variable and `--frozen` flags, and update the entrypoint command to run the CloudWatch server module
6. THE Transform_Script SHALL replace the Docker healthcheck to use `curl -sf http://localhost:8000/mcp`
7. WHEN the transformation of any file completes, THE Transform_Script SHALL validate the result by checking for the presence of expected strings (`streamable-http`, `port=8000`, `fastmcp`, `EXPOSE 8000`) in the transformed files
8. IF any validation check fails, THEN THE Transform_Script SHALL exit with a non-zero status code and print an error message identifying which file and expected pattern failed

### Requirement 4: CloudTrail MCP Server Transformation Script

**User Story:** As a platform engineer, I want a transformation script that patches the upstream CloudTrail MCP server for streamable-http transport, so that it can run as an HTTP service on AgentCore Runtime.

#### Acceptance Criteria

1. THE Transform_Script SHALL clone the upstream AWS Labs MCP repository from `https://github.com/awslabs/mcp.git` using a shallow clone with depth 1
2. THE Transform_Script SHALL navigate to the `src/cloudtrail-mcp-server` directory within the cloned repository
3. THE Transform_Script SHALL patch the server entry point `main()` function to call `mcp.run()` with `transport='streamable-http'`, `host='0.0.0.0'`, `port=8000`, and `stateless_http=True`
4. THE Transform_Script SHALL add the `fastmcp` dependency with version constraint `>=2.0.0,<3.0.0` to the project's `pyproject.toml` and regenerate the lockfile
5. THE Transform_Script SHALL patch the Dockerfile to expose port 8000, remove any UV_FROZEN environment variable and `--frozen` flags, and update the entrypoint command to run the CloudTrail server module
6. THE Transform_Script SHALL replace the Docker healthcheck to use `curl -sf http://localhost:8000/mcp`
7. WHEN the transformation of any file completes, THE Transform_Script SHALL validate the result by checking for the presence of expected strings (`streamable-http`, `port=8000`, `fastmcp`, `EXPOSE 8000`) in the transformed files
8. IF any validation check fails, THEN THE Transform_Script SHALL exit with a non-zero status code and print an error message identifying which file and expected pattern failed

### Requirement 5: CloudWatch MCP Server CodeBuild Project

**User Story:** As a platform engineer, I want a CodeBuild project that builds the CloudWatch MCP server container image, so that the image is automatically built and pushed to ECR during deployment.

#### Acceptance Criteria

1. THE Image_Stack SHALL create a CodeBuild project named `cloudops-cloudwatchmcp-build` that uses the ARM64 Amazon Linux 2 Standard 3.0 build image with privileged mode enabled and SMALL compute type
2. THE Image_Stack SHALL configure the CodeBuild project with S3 source pointing to the `codebuild-scripts/` prefix in the source bucket and a buildspec file named `buildspec-cloudwatch.yml`
3. THE Image_Stack SHALL provide environment variables `AWS_DEFAULT_REGION` (set to the stack region), `AWS_ACCOUNT_ID` (set to the stack account), and `ECR_REPO_URI` (set to the CloudWatch ECR repository URI) to the CodeBuild project
4. THE Image_Stack SHALL grant the CodeBuild project an IAM role with permissions to push images to the CloudWatch ECR repository, obtain ECR authorization tokens, read objects from the S3 source bucket, and write to CloudWatch Logs under the `/aws/codebuild/*` log group
5. THE Image_Stack SHALL configure the CodeBuild project with a build timeout of 30 minutes
6. THE Image_Stack SHALL trigger the CodeBuild project during stack deployment using a CloudFormation Custom Resource backed by the build trigger Lambda function, passing the project name as a resource property
7. WHEN the build trigger Custom Resource completes, THE Image_Stack SHALL create a build waiter Custom Resource backed by the build waiter Lambda function, passing the returned BuildId and a MaxWaitSeconds value of 1200
8. IF the CodeBuild build reaches a terminal failure status (FAILED, FAULT, TIMED_OUT, or STOPPED), THEN THE Image_Stack SHALL fail the stack deployment with an error indicating the build status
9. THE Image_Stack SHALL ensure the CodeBuild project depends on the S3 scripts deployment so that source files are available before the build starts

### Requirement 6: CloudTrail MCP Server CodeBuild Project

**User Story:** As a platform engineer, I want a CodeBuild project that builds the CloudTrail MCP server container image, so that the image is automatically built and pushed to ECR during deployment.

#### Acceptance Criteria

1. THE Image_Stack SHALL create a CodeBuild project named `cloudops-cloudtrailmcp-build` that uses the ARM64 Amazon Linux 2 Standard 3.0 build image with SMALL compute type and privileged mode enabled for Docker builds
2. THE Image_Stack SHALL configure the CodeBuild project to use a buildspec file named `buildspec-cloudtrail.yml` from the `codebuild-scripts/` prefix in the S3 source bucket, with a build timeout of 30 minutes
3. THE Image_Stack SHALL provide environment variables `AWS_DEFAULT_REGION`, `AWS_ACCOUNT_ID`, and `ECR_REPO_URI` to the CodeBuild project, where `AWS_DEFAULT_REGION` and `AWS_ACCOUNT_ID` resolve to the deployment region and account, and `ECR_REPO_URI` resolves to the CloudTrail ECR repository URI
4. THE Image_Stack SHALL grant the CodeBuild project permissions to push images to the CloudTrail ECR repository, obtain ECR authorization tokens, read objects from the S3 source bucket, and write to CloudWatch Logs
5. THE Image_Stack SHALL trigger the CodeBuild project during stack deployment via a CloudFormation CustomResource backed by the build trigger Lambda function, with an explicit dependency ensuring S3 source scripts are deployed before the build starts
6. THE Image_Stack SHALL wait for the CodeBuild project to complete using a CloudFormation CustomResource backed by the build waiter Lambda function with a maximum wait of 1200 seconds, polling every 15 seconds
7. IF the CodeBuild build reaches a terminal failure status (FAILED, FAULT, TIMED_OUT, or STOPPED), THEN THE build waiter CustomResource SHALL signal CloudFormation with a FAILED status, causing the stack deployment to roll back

### Requirement 7: CloudWatch MCP Server Buildspec

**User Story:** As a platform engineer, I want a buildspec file that orchestrates the CloudWatch MCP server build pipeline, so that the transformation, Docker build, and ECR push happen in the correct order.

#### Acceptance Criteria

1. THE Buildspec SHALL use buildspec version 0.2 format
2. THE Buildspec SHALL make `transform-cloudwatch.sh` executable and then execute it in the pre-build phase
3. THE Buildspec SHALL authenticate to Amazon ECR in the pre-build phase by piping `aws ecr get-login-password --region $AWS_DEFAULT_REGION` to `docker login` using the registry endpoint `$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com`
4. THE Buildspec SHALL change to the CloudWatch MCP server source directory produced by the transform script and build a Docker image tagged as `$ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER` in the build phase
5. THE Buildspec SHALL tag the built image as `$ECR_REPO_URI:latest` in the build phase
6. THE Buildspec SHALL push both the `$ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER` and `$ECR_REPO_URI:latest` image tags to ECR in the post-build phase

### Requirement 8: CloudTrail MCP Server Buildspec

**User Story:** As a platform engineer, I want a buildspec file that orchestrates the CloudTrail MCP server build pipeline, so that the transformation, Docker build, and ECR push happen in the correct order.

#### Acceptance Criteria

1. THE Buildspec SHALL use version 0.2 and organize commands into exactly three phases: pre_build, build, and post_build
2. THE Buildspec SHALL set the script `transform-cloudtrail.sh` as executable and execute it in the pre-build phase
3. THE Buildspec SHALL authenticate to Amazon ECR in the pre-build phase by piping the output of `aws ecr get-login-password --region $AWS_DEFAULT_REGION` to `docker login` using the registry endpoint `$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com`
4. THE Buildspec SHALL change directory to the CloudTrail MCP server source folder and build a Docker image tagged as `$ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER`, then tag that image as `$ECR_REPO_URI:latest`, in the build phase
5. THE Buildspec SHALL push both the `$ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER` and `$ECR_REPO_URI:latest` image tags to ECR in the post-build phase

### Requirement 9: CloudWatch MCP Server AgentCore Runtime

**User Story:** As a platform engineer, I want the CloudWatch MCP server deployed as an AgentCore Runtime with JWT authorization, so that the Gateway can securely invoke it.

#### Acceptance Criteria

1. THE MCP_Runtime_Stack SHALL create an AgentCore Runtime of type `AWS::BedrockAgentCore::Runtime` named `cloudops_cloudwatch_mcp_jwt_v1` using the CloudWatch ECR repository image tagged `latest`
2. THE MCP_Runtime_Stack SHALL configure the runtime with CustomJWTAuthorizer using the Cognito User Pool OpenID Connect discovery URL (format: `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/openid-configuration`) and the M2M client ID in the AllowedClients list
3. THE MCP_Runtime_Stack SHALL configure the runtime with PUBLIC network mode and ProtocolConfiguration set to `MCP`
4. THE MCP_Runtime_Stack SHALL create a dedicated IAM role with assume-role trust policy for the `bedrock-agentcore.amazonaws.com` service principal for the CloudWatch runtime
5. THE MCP_Runtime_Stack SHALL grant the CloudWatch runtime role permissions for `cloudwatch:*` and `logs:*` operations on all resources, in addition to the common runtime permissions (ECR authorization token, CloudWatch Logs for the `/aws/bedrock-agentcore/runtimes/*` log group, and Gateway invocation)
6. THE MCP_Runtime_Stack SHALL grant the CloudWatch runtime role ECR image pull permissions scoped to the CloudWatch MCP ECR repository
7. WHEN the stack is deployed, THE MCP_Runtime_Stack SHALL export the CloudWatch runtime ARN and the runtime endpoint URL (format: `https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{encoded-arn}/invocations?qualifier=DEFAULT`) as named CloudFormation stack outputs
8. THE MCP_Runtime_Stack SHALL configure an explicit CDK dependency so that the runtime resource is created only after the IAM role resource exists

### Requirement 10: CloudTrail MCP Server AgentCore Runtime

**User Story:** As a platform engineer, I want the CloudTrail MCP server deployed as an AgentCore Runtime with JWT authorization, so that the Gateway can securely invoke it.

#### Acceptance Criteria

1. THE MCP_Runtime_Stack SHALL create an AgentCore Runtime named `cloudops_cloudtrail_mcp_jwt_v1` using the CloudTrail ECR repository image with the `latest` tag
2. THE MCP_Runtime_Stack SHALL configure the runtime with CustomJWTAuthorizer specifying the M2M client ID in AllowedClients and the Cognito User Pool OpenID Connect discovery URL in the format `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/openid-configuration`
3. THE MCP_Runtime_Stack SHALL configure the runtime with PUBLIC network mode and ProtocolConfiguration set to `MCP`
4. THE MCP_Runtime_Stack SHALL create a dedicated IAM role with `bedrock-agentcore.amazonaws.com` as the trusted service principal for the CloudTrail runtime
5. THE MCP_Runtime_Stack SHALL grant the CloudTrail runtime role permissions for `cloudtrail:LookupEvents`, `cloudtrail:GetTrailStatus`, `cloudtrail:DescribeTrails`, `cloudtrail:GetEventSelectors`, and `cloudtrail:ListTrails` on all resources in the account
6. THE MCP_Runtime_Stack SHALL grant the CloudTrail runtime role common AgentCore permissions including `ecr:GetAuthorizationToken`, CloudWatch Logs access for `/aws/bedrock-agentcore/runtimes/*` log groups, and `bedrock-agentcore:InvokeGateway` for all gateways in the account
7. THE MCP_Runtime_Stack SHALL grant the CloudTrail runtime role ECR image pull access to the CloudTrail MCP ECR repository
8. THE MCP_Runtime_Stack SHALL export the runtime ARN and endpoint URL as named stack outputs using the format `{stackName}-CloudTrailMcpRuntimeArn` and `{stackName}-CloudTrailMcpRuntimeEndpoint`

### Requirement 11: Gateway Target Registration for CloudWatch MCP Server

**User Story:** As a platform engineer, I want the CloudWatch MCP server registered as a target in the AgentCore Gateway, so that the main agent can discover and invoke CloudWatch tools through the Gateway.

#### Acceptance Criteria

1. THE Gateway_Stack SHALL create a Gateway Target resource of type `AWS::BedrockAgentCore::GatewayTarget` named `cloudwatchMcp`, with its `GatewayIdentifier` set to the Gateway created within the same stack and its `TargetConfiguration.Mcp.McpServer.Endpoint` set to the CloudWatch MCP Runtime endpoint passed via stack props
2. THE Gateway_Stack SHALL configure the `cloudwatchMcp` target with a `CredentialProviderConfigurations` entry of type `OAUTH`, referencing the OAuth provider ARN created within the same stack and specifying `mcp-runtime-server/invoke` as the scope
3. THE Gateway_Stack SHALL add a CDK deployment dependency from the `cloudwatchMcp` target to the Gateway resource, ensuring the Gateway is created before the target during deployment
4. THE Gateway_Stack SHALL accept a `cloudwatchMcpRuntimeEndpoint` property (string) representing the CloudWatch MCP Runtime invocation URL, following the same endpoint format used by the billing and pricing runtime endpoints

### Requirement 12: Gateway Target Registration for CloudTrail MCP Server

**User Story:** As a platform engineer, I want the CloudTrail MCP server registered as a target in the AgentCore Gateway, so that the main agent can discover and invoke CloudTrail tools through the Gateway.

#### Acceptance Criteria

1. THE Gateway_Stack SHALL accept the CloudTrail MCP Runtime endpoint as an input property and create a Gateway Target resource with the name `cloudtrailMcp`, the GatewayIdentifier of the created Gateway, and a TargetConfiguration pointing to the CloudTrail MCP Runtime endpoint
2. THE Gateway_Stack SHALL configure the `cloudtrailMcp` target with a credential provider of type `OAUTH`, referencing the OAuth provider ARN created within the same stack and specifying the `mcp-runtime-server/invoke` scope
3. THE Gateway_Stack SHALL add a deployment dependency from the `cloudtrailMcp` target to the Gateway resource so that the target is created only after the Gateway exists

### Requirement 13: Agent System Prompt Update

**User Story:** As a CloudOps analyst, I want the agent to be aware of CloudWatch and CloudTrail tools, so that it can help me investigate operational metrics and API activity.

#### Acceptance Criteria

1. THE Agent_Runtime SHALL include CloudWatch capabilities in the system prompt describing available tool categories including metrics queries, alarm status, log group listing, and log insights queries, with usage guidance instructing the agent to use `cloudwatchMcp__`-prefixed tools for these operations
2. THE Agent_Runtime SHALL include CloudTrail capabilities in the system prompt describing available tool categories including event history lookup, trail status, and API activity investigation, with usage guidance instructing the agent to use `cloudtrailMcp__`-prefixed tools for these operations
3. THE Agent_Runtime SHALL reference tools prefixed with `cloudwatchMcp__` for CloudWatch operations and `cloudtrailMcp__` for CloudTrail operations in the system prompt guidance
4. THE Agent_Runtime SHALL include routing guidance in the system prompt instructing the agent to use CloudWatch tools when the user asks about operational metrics, alarms, or log analysis, and to use CloudTrail tools when the user asks about API call history, resource changes, or account activity auditing

### Requirement 14: CDK Stack Interface Updates

**User Story:** As a platform engineer, I want the CDK stack interfaces updated to pass CloudWatch and CloudTrail runtime information between stacks, so that the deployment pipeline properly chains dependencies.

#### Acceptance Criteria

1. THE MCP_Runtime_Stack SHALL accept CloudWatch and CloudTrail ECR repository references as input properties of type ecr.IRepository in its MCPRuntimeStackProps interface, following the same pattern as the existing billingMcpRepository and pricingMcpRepository properties
2. THE MCP_Runtime_Stack SHALL expose CloudWatch and CloudTrail runtime ARNs as public readonly string properties and runtime endpoints as public readonly string properties formatted as MCP runtime invocation URLs
3. THE Gateway_Stack SHALL accept CloudWatch and CloudTrail runtime ARNs and runtime endpoints as input string properties in its AgentCoreGatewayStackProps interface, following the same pattern as the existing billingMcpRuntimeArn, billingMcpRuntimeEndpoint, pricingMcpRuntimeArn, and pricingMcpRuntimeEndpoint properties
4. THE CDK application entry point SHALL pass CloudWatch and CloudTrail ECR repositories from Image_Stack to MCP_Runtime_Stack and declare an addDependency from MCP_Runtime_Stack to Image_Stack
5. THE CDK application entry point SHALL pass CloudWatch and CloudTrail runtime ARNs and endpoints from MCP_Runtime_Stack to Gateway_Stack and declare an addDependency from Gateway_Stack to MCP_Runtime_Stack
6. WHEN the Gateway_Stack receives CloudWatch and CloudTrail runtime endpoints, THE Gateway_Stack SHALL configure corresponding gateway targets for each endpoint, following the same pattern as the existing BillingMcpTarget and PricingMcpTarget resources
