"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPRuntimeStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const events_targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const path = __importStar(require("path"));
const cdk_nag_1 = require("cdk-nag");
class MCPRuntimeStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========================================
        // IAM Roles for MCP Runtimes
        // ========================================
        // Billing MCP Server Runtime Role
        const billingMcpRuntimeRole = new iam.Role(this, 'BillingMcpRuntimeRole', {
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Pricing MCP Server Runtime Role
        const pricingMcpRuntimeRole = new iam.Role(this, 'PricingMcpRuntimeRole', {
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Common AgentCore Runtime permissions (ECR, CloudWatch, X-Ray, Bedrock, Gateway)
        const commonRuntimePermissions = [
            // ECR token access
            new iam.PolicyStatement({
                sid: 'ECRTokenAccess',
                effect: iam.Effect.ALLOW,
                actions: ['ecr:GetAuthorizationToken'],
                resources: ['*'],
            }),
            // CloudWatch Logs
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:DescribeLogGroups'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
            }),
            // Gateway invocation
            new iam.PolicyStatement({
                sid: 'AllowGatewayInvocation',
                effect: iam.Effect.ALLOW,
                actions: ['bedrock-agentcore:InvokeGateway'],
                resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`],
            }),
        ];
        // Add common permissions to both roles
        for (const stmt of commonRuntimePermissions) {
            billingMcpRuntimeRole.addToPolicy(stmt);
            pricingMcpRuntimeRole.addToPolicy(stmt);
        }
        // ECR image pull for each role's specific repository
        props.billingMcpRepository.grantPull(billingMcpRuntimeRole);
        props.pricingMcpRepository.grantPull(pricingMcpRuntimeRole);
        // Add Cost Explorer and billing permissions to Billing MCP Runtime
        // Statement 1 — Cost-management & pricing APIs. These services
        // (Cost Explorer, Budgets, Compute Optimizer, Free Tier, Cost Optimization
        // Hub, Pricing) are account/region-global and do NOT support resource-level
        // ARNs, so Resource: '*' is required. Actions are scoped to read-only verbs
        // (Get*/Describe*/List*/ViewBudget) — no Create*/Modify*/Delete*.
        billingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            sid: 'CostManagementAndPricingReadOnly',
            effect: iam.Effect.ALLOW,
            actions: [
                // Read-only verb-scoped actions (no Create*/Modify*/Delete*): the
                // billing server only reads cost/usage/optimization data. These
                // services are account-global and do not support resource-level ARNs.
                'ce:Get*',
                'ce:Describe*',
                'ce:List*',
                'budgets:Describe*',
                'budgets:ViewBudget',
                'compute-optimizer:Get*',
                'compute-optimizer:Describe*',
                'freetier:Get*',
                'cost-optimization-hub:Get*',
                'cost-optimization-hub:List*',
                'pricing:GetProducts',
                'pricing:GetAttributeValues',
                'pricing:DescribeServices',
                'pricing:ListPriceListFiles',
                'pricing:GetPriceListFileUrl',
            ],
            resources: ['*'],
        }));
        // Statement 2 — Resource-inventory Describe/List actions used by the
        // upstream Billing MCP server's rightsizing / Compute Optimizer features to
        // correlate cost data with EC2/EBS/Auto Scaling/Lambda/ECS resources. These
        // are all read-only Describe*/List*/Get* actions; the AWS Describe/List APIs
        // they call are region-scoped and do not accept resource-level ARNs, so
        // Resource: '*' is required. They are required for the billing tools to
        // function — removing them breaks rightsizing/optimization lookups.
        billingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            sid: 'ResourceInventoryReadOnly',
            effect: iam.Effect.ALLOW,
            actions: [
                'ec2:DescribeInstances',
                'ec2:DescribeVolumes',
                'ec2:DescribeInstanceTypes',
                'ec2:DescribeRegions',
                'autoscaling:DescribeAutoScalingGroups',
                'lambda:ListFunctions',
                'lambda:GetFunction',
                'ecs:ListClusters',
                'ecs:ListServices',
                'ecs:DescribeServices',
            ],
            resources: ['*'],
        }));
        // Add Pricing API permissions to Pricing MCP Runtime
        pricingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'pricing:GetProducts',
                'pricing:GetAttributeValues',
                'pricing:DescribeServices',
                'pricing:ListPriceListFiles',
                'pricing:GetPriceListFileUrl',
            ],
            resources: ['*'],
        }));
        // ========================================
        // MCP Runtimes with JWT Authorization
        // Gateway sends OAuth Bearer tokens, Runtimes validate JWT
        // ========================================
        // Billing MCP Server Runtime
        const cfnBillingMcpRuntime = new cdk.CfnResource(this, 'BillingMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'cloudops_billing_mcp_jwt_v1',
                Description: 'AWS Labs Billing MCP Server Runtime with JWT authorization',
                RoleArn: billingMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.billingMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    // The Billing MCP server uses the standalone `fastmcp` package (v3+),
                    // which ships a HostOriginGuard middleware that DNS-rebinding-rejects
                    // any Host header outside localhost with HTTP 421 ("Misdirected
                    // Request"). The AgentCore Gateway reaches this runtime through the
                    // authenticated AgentCore ingress (its Host header is the runtime's
                    // public endpoint, not localhost), so the guard rejects tool
                    // discovery with 421 and the Gateway target fails to stabilize.
                    // Disabling host/origin protection is safe here: the runtime is only
                    // reachable via the CustomJWTAuthorizer-protected ingress, so the
                    // browser-focused DNS-rebinding protection is redundant. (The mcp-SDK
                    // FastMCP servers — cloudwatch/cloudtrail/inventory — instead set
                    // `mcp.settings.transport_security = None`, which is the equivalent
                    // for that library.)
                    FASTMCP_HTTP_HOST_ORIGIN_PROTECTION: 'false',
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnBillingMcpRuntime.node.addDependency(billingMcpRuntimeRole);
        this.billingMcpRuntimeArn = cfnBillingMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
        const encodedBillingArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.billingMcpRuntimeArn)))),
        ]);
        this.billingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedBillingArn}/invocations?qualifier=DEFAULT`;
        // Pricing MCP Server Runtime
        const cfnPricingMcpRuntime = new cdk.CfnResource(this, 'PricingMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'cloudops_pricing_mcp_jwt_v1',
                Description: 'AWS Labs Pricing MCP Server Runtime with JWT authorization',
                RoleArn: pricingMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.pricingMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    // The Pricing MCP server also uses the standalone `fastmcp` package.
                    // Its patch currently pins fastmcp<3 (no HostOriginGuard), but set
                    // this defensively so a future pin bump to v3+ does not reintroduce
                    // the 421 Host-header rejection. Harmless on fastmcp v2 (unknown env
                    // vars are ignored). See the Billing runtime above for details.
                    FASTMCP_HTTP_HOST_ORIGIN_PROTECTION: 'false',
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnPricingMcpRuntime.node.addDependency(pricingMcpRuntimeRole);
        this.pricingMcpRuntimeArn = cfnPricingMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
        const encodedPricingArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.pricingMcpRuntimeArn)))),
        ]);
        this.pricingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedPricingArn}/invocations?qualifier=DEFAULT`;
        // ========================================
        // CloudWatch MCP Server Runtime
        // ========================================
        // CloudWatch MCP Server Runtime Role
        const cloudwatchMcpRuntimeRole = new iam.Role(this, 'CloudWatchMcpRuntimeRole', {
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Add common permissions to CloudWatch runtime role
        for (const stmt of commonRuntimePermissions) {
            cloudwatchMcpRuntimeRole.addToPolicy(stmt);
        }
        // ECR image pull for CloudWatch repository
        props.cloudwatchMcpRepository.grantPull(cloudwatchMcpRuntimeRole);
        // Grant CloudWatch and Logs READ-ONLY permissions. The CloudWatch MCP
        // server only reads metrics/alarms/dashboards/log groups and runs Logs
        // Insights queries, so this is scoped to Describe*/Get*/List* plus the
        // (non-destructive) Logs Insights query verbs — no Put*/Delete*/Create*.
        // CloudWatch/Logs read APIs are account/region-level and do not support
        // resource-level ARNs, so Resource: '*' is required.
        cloudwatchMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            sid: 'CloudWatchAndLogsReadOnly',
            effect: iam.Effect.ALLOW,
            actions: [
                'cloudwatch:Describe*',
                'cloudwatch:Get*',
                'cloudwatch:List*',
                'logs:Describe*',
                'logs:Get*',
                'logs:List*',
                'logs:FilterLogEvents',
                'logs:StartQuery',
                'logs:StopQuery',
            ],
            resources: ['*'],
        }));
        // CloudWatch MCP Server Runtime
        const cfnCloudWatchMcpRuntime = new cdk.CfnResource(this, 'CloudWatchMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'cloudops_cloudwatch_mcp_jwt_v1',
                Description: 'AWS Labs CloudWatch MCP Server Runtime with JWT authorization',
                RoleArn: cloudwatchMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.cloudwatchMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnCloudWatchMcpRuntime.node.addDependency(cloudwatchMcpRuntimeRole);
        this.cloudwatchMcpRuntimeArn = cfnCloudWatchMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        const encodedCloudWatchArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.cloudwatchMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.cloudwatchMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.cloudwatchMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.cloudwatchMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.cloudwatchMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.cloudwatchMcpRuntimeArn)))),
        ]);
        this.cloudwatchMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedCloudWatchArn}/invocations?qualifier=DEFAULT`;
        // ========================================
        // CloudTrail MCP Server Runtime
        // ========================================
        // CloudTrail MCP Server Runtime Role
        const cloudtrailMcpRuntimeRole = new iam.Role(this, 'CloudTrailMcpRuntimeRole', {
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Add common permissions to CloudTrail runtime role
        for (const stmt of commonRuntimePermissions) {
            cloudtrailMcpRuntimeRole.addToPolicy(stmt);
        }
        // ECR image pull for CloudTrail repository
        props.cloudtrailMcpRepository.grantPull(cloudtrailMcpRuntimeRole);
        // CloudTrail read-only audit permissions. Resource: '*' is required and
        // cannot be scoped to specific trail ARNs: the CloudTrail MCP server reads
        // EXISTING account trails/events that this stack does not create, so the
        // trail ARNs are unknown at deploy time. LookupEvents and ListTrails are
        // account-level APIs by design; the remaining actions (GetTrailStatus,
        // DescribeTrails, GetEventSelectors) are read-only and do not expose
        // mutating capability.
        cloudtrailMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            sid: 'CloudTrailReadOnlyAudit',
            effect: iam.Effect.ALLOW,
            actions: [
                'cloudtrail:LookupEvents',
                'cloudtrail:GetTrailStatus',
                'cloudtrail:DescribeTrails',
                'cloudtrail:GetEventSelectors',
                'cloudtrail:ListTrails',
            ],
            resources: ['*'],
        }));
        // CloudTrail MCP Server Runtime
        const cfnCloudTrailMcpRuntime = new cdk.CfnResource(this, 'CloudTrailMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'cloudops_cloudtrail_mcp_jwt_v1',
                Description: 'AWS Labs CloudTrail MCP Server Runtime with JWT authorization',
                RoleArn: cloudtrailMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.cloudtrailMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnCloudTrailMcpRuntime.node.addDependency(cloudtrailMcpRuntimeRole);
        this.cloudtrailMcpRuntimeArn = cfnCloudTrailMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
        const encodedCloudTrailArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.cloudtrailMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.cloudtrailMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.cloudtrailMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.cloudtrailMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.cloudtrailMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.cloudtrailMcpRuntimeArn)))),
        ]);
        this.cloudtrailMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedCloudTrailArn}/invocations?qualifier=DEFAULT`;
        // ========================================
        // DynamoDB EOL Schedules Table (conditional)
        // ========================================
        let eolTableName;
        if (props.eolTableName) {
            // Use existing table name
            eolTableName = props.eolTableName;
        }
        else {
            // Create new DynamoDB table
            const eolTable = new dynamodb.Table(this, 'EolSchedulesTable', {
                tableName: 'aws-eol-schedules',
                partitionKey: { name: 'service', type: dynamodb.AttributeType.STRING },
                sortKey: { name: 'version', type: dynamodb.AttributeType.STRING },
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
            });
            eolTableName = eolTable.tableName;
        }
        // ========================================
        // Inventory MCP Server Runtime
        // ========================================
        // Inventory MCP Server Runtime Role
        const inventoryMcpRuntimeRole = new iam.Role(this, 'InventoryMcpRuntimeRole', {
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Add common permissions to Inventory runtime role
        for (const stmt of commonRuntimePermissions) {
            inventoryMcpRuntimeRole.addToPolicy(stmt);
        }
        // ECR image pull for Inventory repository
        props.inventoryMcpRepository.grantPull(inventoryMcpRuntimeRole);
        // Read-only cross-service inventory discovery (EKS, RDS, OpenSearch,
        // ElastiCache, MSK, EC2). All actions are List*/Describe* reads. These
        // Describe/List APIs enumerate resources account/region-wide and do NOT
        // support resource-level ARNs, so Resource: '*' is required for the
        // inventory server to discover clusters across the account. No mutating
        // (Create/Modify/Delete) actions are granted.
        inventoryMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            sid: 'InventoryReadOnlyDiscovery',
            effect: iam.Effect.ALLOW,
            actions: [
                'eks:ListClusters',
                'eks:DescribeCluster',
                'eks:ListNodegroups',
                'eks:DescribeNodegroup',
                'rds:DescribeDBInstances',
                'rds:DescribeDBClusters',
                'rds:DescribeDBEngineVersions',
                'es:ListDomainNames',
                'es:DescribeDomain',
                'es:DescribeDomains',
                'elasticache:DescribeCacheClusters',
                'elasticache:DescribeReplicationGroups',
                'kafka:ListClusters',
                'kafka:ListClustersV2',
                'kafka:DescribeCluster',
                'kafka:DescribeClusterV2',
                'ec2:DescribeRegions',
            ],
            resources: ['*'],
        }));
        // Grant DynamoDB read access on EOL table
        const eolTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${eolTableName}`;
        inventoryMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:GetItem',
                'dynamodb:Query',
                'dynamodb:Scan',
            ],
            resources: [eolTableArn],
        }));
        // Inventory MCP Server Runtime
        const cfnInventoryMcpRuntime = new cdk.CfnResource(this, 'InventoryMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'cloudops_inventory_mcp_jwt_v1',
                Description: 'Inventory MCP Server Runtime with JWT authorization',
                RoleArn: inventoryMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.inventoryMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    EOL_TABLE_NAME: eolTableName,
                    MCP_TRANSPORT: 'streamable-http',
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnInventoryMcpRuntime.node.addDependency(inventoryMcpRuntimeRole);
        this.inventoryMcpRuntimeArn = cfnInventoryMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        const encodedInventoryArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.inventoryMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.inventoryMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.inventoryMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.inventoryMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.inventoryMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.inventoryMcpRuntimeArn)))),
        ]);
        this.inventoryMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedInventoryArn}/invocations?qualifier=DEFAULT`;
        // ========================================
        // EOL Scraper Lambda Function
        // ========================================
        const eolScraperPath = path.join(__dirname, '../../mcp-servers/inventory/eol-scraper');
        const eolScraperFunction = new lambda.Function(this, 'EolScraperFunction', {
            functionName: `${this.stackName}-EolScraper`,
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'eol_scraper.main.handler',
            code: lambda.Code.fromAsset(eolScraperPath, {
                bundling: {
                    image: lambda.Runtime.PYTHON_3_12.bundlingImage,
                    command: [
                        'bash', '-c',
                        // --no-warn-conflicts: the scraper's deps (boto3/requests/bs4) are
                        // pure-Python and install cleanly into the asset dir; the flag just
                        // suppresses pip's noisy notice about UNRELATED packages that happen
                        // to be present in the surrounding environment.
                        'pip install -r requirements.txt -t /asset-output --no-warn-conflicts && cp -au . /asset-output',
                    ],
                    local: {
                        tryBundle(outputDir) {
                            // Use execFileSync with an explicit argument vector (NOT a shell
                            // string) so no shell is spawned and there is no command-injection
                            // surface — inputs are CDK-controlled build paths regardless.
                            // --no-warn-conflicts silences pip's "dependency resolver does not
                            // currently take into account..." notice (triggered by unrelated
                            // packages in the host Python env, not the scraper's deps).
                            const { execFileSync } = require('child_process');
                            const fs = require('fs');
                            try {
                                execFileSync('python3', [
                                    '-m', 'pip', 'install',
                                    '-r', `${eolScraperPath}/requirements.txt`,
                                    '-t', outputDir,
                                    '--quiet', '--no-warn-conflicts',
                                ], { stdio: 'ignore' });
                                // Copy the package source with the Node fs API — no subprocess.
                                fs.cpSync(`${eolScraperPath}/eol_scraper`, `${outputDir}/eol_scraper`, { recursive: true });
                                return true;
                            }
                            catch {
                                return false;
                            }
                        },
                    },
                },
            }),
            memorySize: 512,
            timeout: cdk.Duration.minutes(5),
            environment: {
                EOL_TABLE_NAME: eolTableName,
            },
        });
        // Grant DynamoDB write permissions to Lambda
        eolScraperFunction.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:PutItem',
                'dynamodb:BatchWriteItem',
                'dynamodb:CreateTable',
                'dynamodb:DescribeTable',
            ],
            resources: [eolTableArn],
        }));
        // Grant EKS DescribeClusterVersions permission
        eolScraperFunction.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'eks:DescribeClusterVersions',
                'es:ListVersions',
                'es:ListElasticsearchVersions',
                'elasticache:DescribeCacheEngineVersions',
                'kafka:GetCompatibleKafkaVersions',
                'rds:DescribeDBEngineVersions',
            ],
            resources: ['*'],
        }));
        // EventBridge rule to trigger Lambda daily
        const eolScraperSchedule = new events.Rule(this, 'EolScraperSchedule', {
            ruleName: `${this.stackName}-EolScraperDailySchedule`,
            schedule: events.Schedule.rate(cdk.Duration.days(1)),
        });
        eolScraperSchedule.addTarget(new events_targets.LambdaFunction(eolScraperFunction));
        // ========================================
        // Outputs
        // ========================================
        // The EOL scraper runs on a DAILY schedule, so the EOL table is EMPTY until
        // the first scheduled run. After deployment, invoke it once manually to
        // populate the table immediately (see README "Populate the EOL data").
        new cdk.CfnOutput(this, 'EolScraperFunctionName', {
            value: eolScraperFunction.functionName,
            // NOTE: an Output Description must be a literal string — do NOT interpolate
            // CDK tokens (e.g. functionName/region) here, or CloudFormation renders it
            // as an Fn::Join and rejects the template ("Every Description member must
            // be a string"). The function name is carried in `value`; invoke with:
            //   aws lambda invoke --function-name <value> --region <region> /dev/stdout
            description: 'EOL scraper Lambda name — invoke once after deploy to populate the EOL table (see README).',
            exportName: `${this.stackName}-EolScraperFunctionName`,
        });
        new cdk.CfnOutput(this, 'BillingMcpRuntimeArn', {
            value: this.billingMcpRuntimeArn,
            description: 'Billing MCP Server Runtime ARN',
            exportName: `${this.stackName}-BillingMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'BillingMcpRuntimeEndpoint', {
            value: this.billingMcpRuntimeEndpoint,
            description: 'Billing MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-BillingMcpRuntimeEndpoint`,
        });
        new cdk.CfnOutput(this, 'PricingMcpRuntimeArn', {
            value: this.pricingMcpRuntimeArn,
            description: 'Pricing MCP Server Runtime ARN',
            exportName: `${this.stackName}-PricingMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'PricingMcpRuntimeEndpoint', {
            value: this.pricingMcpRuntimeEndpoint,
            description: 'Pricing MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-PricingMcpRuntimeEndpoint`,
        });
        new cdk.CfnOutput(this, 'CloudWatchMcpRuntimeArnOutput', {
            value: this.cloudwatchMcpRuntimeArn,
            description: 'CloudWatch MCP Server Runtime ARN',
            exportName: `${this.stackName}-CloudWatchMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'CloudWatchMcpRuntimeEndpointOutput', {
            value: this.cloudwatchMcpRuntimeEndpoint,
            description: 'CloudWatch MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-CloudWatchMcpRuntimeEndpoint`,
        });
        new cdk.CfnOutput(this, 'CloudTrailMcpRuntimeArnOutput', {
            value: this.cloudtrailMcpRuntimeArn,
            description: 'CloudTrail MCP Server Runtime ARN',
            exportName: `${this.stackName}-CloudTrailMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'CloudTrailMcpRuntimeEndpointOutput', {
            value: this.cloudtrailMcpRuntimeEndpoint,
            description: 'CloudTrail MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-CloudTrailMcpRuntimeEndpoint`,
        });
        new cdk.CfnOutput(this, 'InventoryMcpRuntimeArn', {
            value: this.inventoryMcpRuntimeArn,
            description: 'Inventory MCP Server Runtime ARN',
            exportName: `${this.stackName}-InventoryMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'InventoryMcpRuntimeEndpoint', {
            value: this.inventoryMcpRuntimeEndpoint,
            description: 'Inventory MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-InventoryMcpRuntimeEndpoint`,
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(billingMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for Cost Explorer APIs (account-level services), ECR auth token, CloudWatch, X-Ray',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(pricingMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for AWS Pricing API (global service), ECR auth token, CloudWatch, X-Ray',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(cloudwatchMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for CloudWatch and Logs APIs (account-level services), ECR auth token',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(cloudtrailMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for CloudTrail APIs (account-level services), ECR auth token',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(inventoryMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for EKS, RDS, OpenSearch, ElastiCache, MSK read-only APIs (account-level services), ECR auth token',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(eolScraperFunction, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for EKS DescribeClusterVersions (account-level API)',
            },
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-L1',
                reason: 'Python 3.14 is the latest Lambda runtime version available',
            },
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions',
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for custom resource Lambda functions',
            },
        ]);
    }
}
exports.MCPRuntimeStack = MCPRuntimeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXJ1bnRpbWUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJtY3AtcnVudGltZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMseURBQTJDO0FBRTNDLG1FQUFxRDtBQUNyRCwrREFBaUQ7QUFDakQsK0RBQWlEO0FBQ2pELCtFQUFpRTtBQUNqRSwyQ0FBNkI7QUFFN0IscUNBQTBDO0FBYzFDLE1BQWEsZUFBZ0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQVk1QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTJCO1FBQ25FLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDJDQUEyQztRQUMzQyw2QkFBNkI7UUFDN0IsMkNBQTJDO1FBRTNDLGtDQUFrQztRQUNsQyxNQUFNLHFCQUFxQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDeEUsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLGlDQUFpQyxDQUFDO1NBQ3ZFLENBQUMsQ0FBQztRQUVILGtDQUFrQztRQUNsQyxNQUFNLHFCQUFxQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDeEUsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLGlDQUFpQyxDQUFDO1NBQ3ZFLENBQUMsQ0FBQztRQUVILGtGQUFrRjtRQUNsRixNQUFNLHdCQUF3QixHQUEwQjtZQUN0RCxtQkFBbUI7WUFDbkIsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dCQUN0QixHQUFHLEVBQUUsZ0JBQWdCO2dCQUNyQixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dCQUN4QixPQUFPLEVBQUUsQ0FBQywyQkFB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QUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQztZQUNqRSxLQUFLO1lBQ0wsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQztZQUNqRSxLQUFLO1lBQ0wsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQztZQUNqRSxLQUFLO1lBQ0wsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQztZQUNqRSxLQUFLO1lBQ0wsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQztZQUNqRSxLQUFLO1lBQ0wsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUN6RyxDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsNEJBQTRCLEdBQUcsNkJBQTZCLElBQUksQ0FBQyxNQUFNLDJCQUEyQixvQkFBb0IsZ0NBQWdDLENBQUM7UUFF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RSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsNEZBQTRGO2FBQ3JHO1NBQ0YsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVULHlCQUFlLENBQUMsdUJBQXVCLENBQUMsdUJBQXVCLEVBQUU7WUFDL0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLGtJQUFrSTthQUMzSTtTQUNGLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFVCx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLGtCQUFrQixFQUFFO1lBQzFEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxtRkFBbUY7YUFDNUY7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsc0ZBQXNGO2FBQy9GO1NBQ0YsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVULHlCQUFlLENBQUMsb0JBQW9CLENBQUMsSUFBSSxFQUFFO1lBQ3pDO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw0REFBNEQ7YUFDckU7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsc0ZBQXNGO2FBQy9GO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG9FQUFvRTthQUM3RTtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQW56QkQsMENBbXpCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgZXZlbnRzX3RhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE1DUFJ1bnRpbWVTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBiaWxsaW5nTWNwUmVwb3NpdG9yeTogZWNyLklSZXBvc2l0b3J5O1xuICBwcmljaW5nTWNwUmVwb3NpdG9yeTogZWNyLklSZXBvc2l0b3J5O1xuICBjbG91ZHdhdGNoTWNwUmVwb3NpdG9yeTogZWNyLklSZXBvc2l0b3J5O1xuICBjbG91ZHRyYWlsTWNwUmVwb3NpdG9yeTogZWNyLklSZXBvc2l0b3J5O1xuICBpbnZlbnRvcnlNY3BSZXBvc2l0b3J5OiBlY3IuSVJlcG9zaXRvcnk7XG4gIC8vIEZyb20gQXV0aFN0YWNrIC0gZm9yIEpXVCBhdXRob3JpemF0aW9uIG9uIHJ1bnRpbWVzXG4gIHVzZXJQb29sSWQ6IHN0cmluZztcbiAgbTJtQ2xpZW50SWQ6IHN0cmluZztcbiAgZW9sVGFibGVOYW1lPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgTUNQUnVudGltZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGJpbGxpbmdNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBwcmljaW5nTWNwUnVudGltZUFybjogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgY2xvdWR3YXRjaE1jcFJ1bnRpbWVBcm46IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IGNsb3VkdHJhaWxNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBpbnZlbnRvcnlNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBiaWxsaW5nTWNwUnVudGltZUVuZHBvaW50OiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBwcmljaW5nTWNwUnVudGltZUVuZHBvaW50OiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBjbG91ZHdhdGNoTWNwUnVudGltZUVuZHBvaW50OiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBjbG91ZHRyYWlsTWNwUnVudGltZUVuZHBvaW50OiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBpbnZlbnRvcnlNY3BSdW50aW1lRW5kcG9pbnQ6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTUNQUnVudGltZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBJQU0gUm9sZXMgZm9yIE1DUCBSdW50aW1lc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIEJpbGxpbmcgTUNQIFNlcnZlciBSdW50aW1lIFJvbGVcbiAgICBjb25zdCBiaWxsaW5nTWNwUnVudGltZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0JpbGxpbmdNY3BSdW50aW1lUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdiZWRyb2NrLWFnZW50Y29yZS5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG5cbiAgICAvLyBQcmljaW5nIE1DUCBTZXJ2ZXIgUnVudGltZSBSb2xlXG4gICAgY29uc3QgcHJpY2luZ01jcFJ1bnRpbWVSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdQcmljaW5nTWNwUnVudGltZVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgLy8gQ29tbW9uIEFnZW50Q29yZSBSdW50aW1lIHBlcm1pc3Npb25zIChFQ1IsIENsb3VkV2F0Y2gsIFgtUmF5LCBCZWRyb2NrLCBHYXRld2F5KVxuICAgIGNvbnN0IGNvbW1vblJ1bnRpbWVQZXJtaXNzaW9uczogaWFtLlBvbGljeVN0YXRlbWVudFtdID0gW1xuICAgICAgLy8gRUNSIHRva2VuIGFjY2Vzc1xuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdFQ1JUb2tlbkFjY2VzcycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICB9KSxcbiAgICAgIC8vIENsb3VkV2F0Y2ggTG9nc1xuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnbG9nczpEZXNjcmliZUxvZ0dyb3VwcyddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6KmBdLFxuICAgICAgfSksXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydsb2dzOkRlc2NyaWJlTG9nU3RyZWFtcycsICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJ10sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlL3J1bnRpbWVzLypgXSxcbiAgICAgIH0pLFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnbG9nczpDcmVhdGVMb2dTdHJlYW0nLCAnbG9nczpQdXRMb2dFdmVudHMnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvYmVkcm9jay1hZ2VudGNvcmUvcnVudGltZXMvKjpsb2ctc3RyZWFtOipgXSxcbiAgICAgIH0pLFxuICAgICAgLy8gR2F0ZXdheSBpbnZvY2F0aW9uXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0FsbG93R2F0ZXdheUludm9jYXRpb24nLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnYmVkcm9jay1hZ2VudGNvcmU6SW52b2tlR2F0ZXdheSddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06Z2F0ZXdheS8qYF0sXG4gICAgICB9KSxcbiAgICBdO1xuXG4gICAgLy8gQWRkIGNvbW1vbiBwZXJtaXNzaW9ucyB0byBib3RoIHJvbGVzXG4gICAgZm9yIChjb25zdCBzdG10IG9mIGNvbW1vblJ1bnRpbWVQZXJtaXNzaW9ucykge1xuICAgICAgYmlsbGluZ01jcFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KHN0bXQpO1xuICAgICAgcHJpY2luZ01jcFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KHN0bXQpO1xuICAgIH1cblxuICAgIC8vIEVDUiBpbWFnZSBwdWxsIGZvciBlYWNoIHJvbGUncyBzcGVjaWZpYyByZXBvc2l0b3J5XG4gICAgcHJvcHMuYmlsbGluZ01jcFJlcG9zaXRvcnkuZ3JhbnRQdWxsKGJpbGxpbmdNY3BSdW50aW1lUm9sZSk7XG4gICAgcHJvcHMucHJpY2luZ01jcFJlcG9zaXRvcnkuZ3JhbnRQdWxsKHByaWNpbmdNY3BSdW50aW1lUm9sZSk7XG5cbiAgICAvLyBBZGQgQ29zdCBFeHBsb3JlciBhbmQgYmlsbGluZyBwZXJtaXNzaW9ucyB0byBCaWxsaW5nIE1DUCBSdW50aW1lXG4gICAgLy8gU3RhdGVtZW50IDEg4oCUIENvc3QtbWFuYWdlbWVudCAmIHByaWNpbmcgQVBJcy4gVGhlc2Ugc2VydmljZXNcbiAgICAvLyAoQ29zdCBFeHBsb3JlciwgQnVkZ2V0cywgQ29tcHV0ZSBPcHRpbWl6ZXIsIEZyZWUgVGllciwgQ29zdCBPcHRpbWl6YXRpb25cbiAgICAvLyBIdWIsIFByaWNpbmcpIGFyZSBhY2NvdW50L3JlZ2lvbi1nbG9iYWwgYW5kIGRvIE5PVCBzdXBwb3J0IHJlc291cmNlLWxldmVsXG4gICAgLy8gQVJOcywgc28gUmVzb3VyY2U6ICcqJyBpcyByZXF1aXJlZC4gQWN0aW9ucyBhcmUgc2NvcGVkIHRvIHJlYWQtb25seSB2ZXJic1xuICAgIC8vIChHZXQqL0Rlc2NyaWJlKi9MaXN0Ki9WaWV3QnVkZ2V0KSDigJQgbm8gQ3JlYXRlKi9Nb2RpZnkqL0RlbGV0ZSouXG4gICAgYmlsbGluZ01jcFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ0Nvc3RNYW5hZ2VtZW50QW5kUHJpY2luZ1JlYWRPbmx5JyxcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgLy8gUmVhZC1vbmx5IHZlcmItc2NvcGVkIGFjdGlvbnMgKG5vIENyZWF0ZSovTW9kaWZ5Ki9EZWxldGUqKTogdGhlXG4gICAgICAgIC8vIGJpbGxpbmcgc2VydmVyIG9ubHkgcmVhZHMgY29zdC91c2FnZS9vcHRpbWl6YXRpb24gZGF0YS4gVGhlc2VcbiAgICAgICAgLy8gc2VydmljZXMgYXJlIGFjY291bnQtZ2xvYmFsIGFuZCBkbyBub3Qgc3VwcG9ydCByZXNvdXJjZS1sZXZlbCBBUk5zLlxuICAgICAgICAnY2U6R2V0KicsXG4gICAgICAgICdjZTpEZXNjcmliZSonLFxuICAgICAgICAnY2U6TGlzdConLFxuICAgICAgICAnYnVkZ2V0czpEZXNjcmliZSonLFxuICAgICAgICAnYnVkZ2V0czpWaWV3QnVkZ2V0JyxcbiAgICAgICAgJ2NvbXB1dGUtb3B0aW1pemVyOkdldConLFxuICAgICAgICAnY29tcHV0ZS1vcHRpbWl6ZXI6RGVzY3JpYmUqJyxcbiAgICAgICAgJ2ZyZWV0aWVyOkdldConLFxuICAgICAgICAnY29zdC1vcHRpbWl6YXRpb24taHViOkdldConLFxuICAgICAgICAnY29zdC1vcHRpbWl6YXRpb24taHViOkxpc3QqJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJvZHVjdHMnLFxuICAgICAgICAncHJpY2luZzpHZXRBdHRyaWJ1dGVWYWx1ZXMnLFxuICAgICAgICAncHJpY2luZzpEZXNjcmliZVNlcnZpY2VzJyxcbiAgICAgICAgJ3ByaWNpbmc6TGlzdFByaWNlTGlzdEZpbGVzJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJpY2VMaXN0RmlsZVVybCcsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBTdGF0ZW1lbnQgMiDigJQgUmVzb3VyY2UtaW52ZW50b3J5IERlc2NyaWJlL0xpc3QgYWN0aW9ucyB1c2VkIGJ5IHRoZVxuICAgIC8vIHVwc3RyZWFtIEJpbGxpbmcgTUNQIHNlcnZlcidzIHJpZ2h0c2l6aW5nIC8gQ29tcHV0ZSBPcHRpbWl6ZXIgZmVhdHVyZXMgdG9cbiAgICAvLyBjb3JyZWxhdGUgY29zdCBkYXRhIHdpdGggRUMyL0VCUy9BdXRvIFNjYWxpbmcvTGFtYmRhL0VDUyByZXNvdXJjZXMuIFRoZXNlXG4gICAgLy8gYXJlIGFsbCByZWFkLW9ubHkgRGVzY3JpYmUqL0xpc3QqL0dldCogYWN0aW9uczsgdGhlIEFXUyBEZXNjcmliZS9MaXN0IEFQSXNcbiAgICAvLyB0aGV5IGNhbGwgYXJlIHJlZ2lvbi1zY29wZWQgYW5kIGRvIG5vdCBhY2NlcHQgcmVzb3VyY2UtbGV2ZWwgQVJOcywgc29cbiAgICAvLyBSZXNvdXJjZTogJyonIGlzIHJlcXVpcmVkLiBUaGV5IGFyZSByZXF1aXJlZCBmb3IgdGhlIGJpbGxpbmcgdG9vbHMgdG9cbiAgICAvLyBmdW5jdGlvbiDigJQgcmVtb3ZpbmcgdGhlbSBicmVha3MgcmlnaHRzaXppbmcvb3B0aW1pemF0aW9uIGxvb2t1cHMuXG4gICAgYmlsbGluZ01jcFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ1Jlc291cmNlSW52ZW50b3J5UmVhZE9ubHknLFxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZWMyOkRlc2NyaWJlSW5zdGFuY2VzJyxcbiAgICAgICAgJ2VjMjpEZXNjcmliZVZvbHVtZXMnLFxuICAgICAgICAnZWMyOkRlc2NyaWJlSW5zdGFuY2VUeXBlcycsXG4gICAgICAgICdlYzI6RGVzY3JpYmVSZWdpb25zJyxcbiAgICAgICAgJ2F1dG9zY2FsaW5nOkRlc2NyaWJlQXV0b1NjYWxpbmdHcm91cHMnLFxuICAgICAgICAnbGFtYmRhOkxpc3RGdW5jdGlvbnMnLFxuICAgICAgICAnbGFtYmRhOkdldEZ1bmN0aW9uJyxcbiAgICAgICAgJ2VjczpMaXN0Q2x1c3RlcnMnLFxuICAgICAgICAnZWNzOkxpc3RTZXJ2aWNlcycsXG4gICAgICAgICdlY3M6RGVzY3JpYmVTZXJ2aWNlcycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgUHJpY2luZyBBUEkgcGVybWlzc2lvbnMgdG8gUHJpY2luZyBNQ1AgUnVudGltZVxuICAgIHByaWNpbmdNY3BSdW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdwcmljaW5nOkdldFByb2R1Y3RzJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0QXR0cmlidXRlVmFsdWVzJyxcbiAgICAgICAgJ3ByaWNpbmc6RGVzY3JpYmVTZXJ2aWNlcycsXG4gICAgICAgICdwcmljaW5nOkxpc3RQcmljZUxpc3RGaWxlcycsXG4gICAgICAgICdwcmljaW5nOkdldFByaWNlTGlzdEZpbGVVcmwnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE1DUCBSdW50aW1lcyB3aXRoIEpXVCBBdXRob3JpemF0aW9uXG4gICAgLy8gR2F0ZXdheSBzZW5kcyBPQXV0aCBCZWFyZXIgdG9rZW5zLCBSdW50aW1lcyB2YWxpZGF0ZSBKV1RcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBCaWxsaW5nIE1DUCBTZXJ2ZXIgUnVudGltZVxuICAgIGNvbnN0IGNmbkJpbGxpbmdNY3BSdW50aW1lID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnQmlsbGluZ01jcFJ1bnRpbWUnLCB7XG4gICAgICB0eXBlOiAnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpSdW50aW1lJyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgQWdlbnRSdW50aW1lTmFtZTogJ2Nsb3Vkb3BzX2JpbGxpbmdfbWNwX2p3dF92MScsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQVdTIExhYnMgQmlsbGluZyBNQ1AgU2VydmVyIFJ1bnRpbWUgd2l0aCBKV1QgYXV0aG9yaXphdGlvbicsXG4gICAgICAgIFJvbGVBcm46IGJpbGxpbmdNY3BSdW50aW1lUm9sZS5yb2xlQXJuLFxuICAgICAgICBBdXRob3JpemVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIEN1c3RvbUpXVEF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIEFsbG93ZWRDbGllbnRzOiBbcHJvcHMubTJtQ2xpZW50SWRdLFxuICAgICAgICAgICAgRGlzY292ZXJ5VXJsOiBgaHR0cHM6Ly9jb2duaXRvLWlkcC4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cHJvcHMudXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgQWdlbnRSdW50aW1lQXJ0aWZhY3Q6IHtcbiAgICAgICAgICBDb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJVcmk6IGAke3Byb3BzLmJpbGxpbmdNY3BSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGBcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIE5ldHdvcmtDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgTmV0d29ya01vZGU6ICdQVUJMSUMnXG4gICAgICAgIH0sXG4gICAgICAgIEVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgQVdTX1JFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgICAgLy8gVGhlIEJpbGxpbmcgTUNQIHNlcnZlciB1c2VzIHRoZSBzdGFuZGFsb25lIGBmYXN0bWNwYCBwYWNrYWdlICh2MyspLFxuICAgICAgICAgIC8vIHdoaWNoIHNoaXBzIGEgSG9zdE9yaWdpbkd1YXJkIG1pZGRsZXdhcmUgdGhhdCBETlMtcmViaW5kaW5nLXJlamVjdHNcbiAgICAgICAgICAvLyBhbnkgSG9zdCBoZWFkZXIgb3V0c2lkZSBsb2NhbGhvc3Qgd2l0aCBIVFRQIDQyMSAoXCJNaXNkaXJlY3RlZFxuICAgICAgICAgIC8vIFJlcXVlc3RcIikuIFRoZSBBZ2VudENvcmUgR2F0ZXdheSByZWFjaGVzIHRoaXMgcnVudGltZSB0aHJvdWdoIHRoZVxuICAgICAgICAgIC8vIGF1dGhlbnRpY2F0ZWQgQWdlbnRDb3JlIGluZ3Jlc3MgKGl0cyBIb3N0IGhlYWRlciBpcyB0aGUgcnVudGltZSdzXG4gICAgICAgICAgLy8gcHVibGljIGVuZHBvaW50LCBub3QgbG9jYWxob3N0KSwgc28gdGhlIGd1YXJkIHJlamVjdHMgdG9vbFxuICAgICAgICAgIC8vIGRpc2NvdmVyeSB3aXRoIDQyMSBhbmQgdGhlIEdhdGV3YXkgdGFyZ2V0IGZhaWxzIHRvIHN0YWJpbGl6ZS5cbiAgICAgICAgICAvLyBEaXNhYmxpbmcgaG9zdC9vcmlnaW4gcHJvdGVjdGlvbiBpcyBzYWZlIGhlcmU6IHRoZSBydW50aW1lIGlzIG9ubHlcbiAgICAgICAgICAvLyByZWFjaGFibGUgdmlhIHRoZSBDdXN0b21KV1RBdXRob3JpemVyLXByb3RlY3RlZCBpbmdyZXNzLCBzbyB0aGVcbiAgICAgICAgICAvLyBicm93c2VyLWZvY3VzZWQgRE5TLXJlYmluZGluZyBwcm90ZWN0aW9uIGlzIHJlZHVuZGFudC4gKFRoZSBtY3AtU0RLXG4gICAgICAgICAgLy8gRmFzdE1DUCBzZXJ2ZXJzIOKAlCBjbG91ZHdhdGNoL2Nsb3VkdHJhaWwvaW52ZW50b3J5IOKAlCBpbnN0ZWFkIHNldFxuICAgICAgICAgIC8vIGBtY3Auc2V0dGluZ3MudHJhbnNwb3J0X3NlY3VyaXR5ID0gTm9uZWAsIHdoaWNoIGlzIHRoZSBlcXVpdmFsZW50XG4gICAgICAgICAgLy8gZm9yIHRoYXQgbGlicmFyeS4pXG4gICAgICAgICAgRkFTVE1DUF9IVFRQX0hPU1RfT1JJR0lOX1BST1RFQ1RJT046ICdmYWxzZScsXG4gICAgICAgICAgREVQTE9ZTUVOVF9USU1FU1RBTVA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSxcbiAgICAgICAgUHJvdG9jb2xDb25maWd1cmF0aW9uOiAnTUNQJyxcbiAgICAgICAgTGlmZWN5Y2xlQ29uZmlndXJhdGlvbjoge30sXG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgY2ZuQmlsbGluZ01jcFJ1bnRpbWUubm9kZS5hZGREZXBlbmRlbmN5KGJpbGxpbmdNY3BSdW50aW1lUm9sZSk7XG5cbiAgICB0aGlzLmJpbGxpbmdNY3BSdW50aW1lQXJuID0gY2ZuQmlsbGluZ01jcFJ1bnRpbWUuZ2V0QXR0KCdBZ2VudFJ1bnRpbWVBcm4nKS50b1N0cmluZygpO1xuICAgIC8vIE1DUCBSdW50aW1lIGVuZHBvaW50IGZvcm1hdCBmb3IgQWdlbnRDb3JlIEdhdGV3YXkgdGFyZ2V0cyAoZnJvbSBBV1MgZG9jdW1lbnRhdGlvbilcbiAgICAvLyBGb3JtYXQ6IGh0dHBzOi8vYmVkcm9jay1hZ2VudGNvcmUue3JlZ2lvbn0uYW1hem9uYXdzLmNvbS9ydW50aW1lcy97RU5DT0RFRF9BUk59L2ludm9jYXRpb25zP3F1YWxpZmllcj1ERUZBVUxUXG4gICAgLy8gVGhlIEFSTiBtdXN0IGJlIFVSTC1lbmNvZGVkICg6IOKGkiAlM0EsIC8g4oaSICUyRilcbiAgICAvLyBSZWZlcmVuY2U6IGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9iZWRyb2NrLWFnZW50Y29yZS9sYXRlc3QvZGV2Z3VpZGUvcnVudGltZS1tY3AuaHRtbFxuICAgIGNvbnN0IGVuY29kZWRCaWxsaW5nQXJuID0gY2RrLkZuLmpvaW4oJycsIFtcbiAgICAgIGNkay5Gbi5zZWxlY3QoMCwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDEsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuYmlsbGluZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmJpbGxpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMywgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDQsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuYmlsbGluZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLmpvaW4oJyUyRicsIGNkay5Gbi5zcGxpdCgnLycsIGNkay5Gbi5zZWxlY3QoNSwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpKSksXG4gICAgXSk7XG4gICAgdGhpcy5iaWxsaW5nTWNwUnVudGltZUVuZHBvaW50ID0gYGh0dHBzOi8vYmVkcm9jay1hZ2VudGNvcmUuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS9ydW50aW1lcy8ke2VuY29kZWRCaWxsaW5nQXJufS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVGA7XG5cbiAgICAvLyBQcmljaW5nIE1DUCBTZXJ2ZXIgUnVudGltZVxuICAgIGNvbnN0IGNmblByaWNpbmdNY3BSdW50aW1lID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnUHJpY2luZ01jcFJ1bnRpbWUnLCB7XG4gICAgICB0eXBlOiAnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpSdW50aW1lJyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgQWdlbnRSdW50aW1lTmFtZTogJ2Nsb3Vkb3BzX3ByaWNpbmdfbWNwX2p3dF92MScsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQVdTIExhYnMgUHJpY2luZyBNQ1AgU2VydmVyIFJ1bnRpbWUgd2l0aCBKV1QgYXV0aG9yaXphdGlvbicsXG4gICAgICAgIFJvbGVBcm46IHByaWNpbmdNY3BSdW50aW1lUm9sZS5yb2xlQXJuLFxuICAgICAgICBBdXRob3JpemVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIEN1c3RvbUpXVEF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIEFsbG93ZWRDbGllbnRzOiBbcHJvcHMubTJtQ2xpZW50SWRdLFxuICAgICAgICAgICAgRGlzY292ZXJ5VXJsOiBgaHR0cHM6Ly9jb2duaXRvLWlkcC4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cHJvcHMudXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgQWdlbnRSdW50aW1lQXJ0aWZhY3Q6IHtcbiAgICAgICAgICBDb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJVcmk6IGAke3Byb3BzLnByaWNpbmdNY3BSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGBcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIE5ldHdvcmtDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgTmV0d29ya01vZGU6ICdQVUJMSUMnXG4gICAgICAgIH0sXG4gICAgICAgIEVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgQVdTX1JFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgICAgLy8gVGhlIFByaWNpbmcgTUNQIHNlcnZlciBhbHNvIHVzZXMgdGhlIHN0YW5kYWxvbmUgYGZhc3RtY3BgIHBhY2thZ2UuXG4gICAgICAgICAgLy8gSXRzIHBhdGNoIGN1cnJlbnRseSBwaW5zIGZhc3RtY3A8MyAobm8gSG9zdE9yaWdpbkd1YXJkKSwgYnV0IHNldFxuICAgICAgICAgIC8vIHRoaXMgZGVmZW5zaXZlbHkgc28gYSBmdXR1cmUgcGluIGJ1bXAgdG8gdjMrIGRvZXMgbm90IHJlaW50cm9kdWNlXG4gICAgICAgICAgLy8gdGhlIDQyMSBIb3N0LWhlYWRlciByZWplY3Rpb24uIEhhcm1sZXNzIG9uIGZhc3RtY3AgdjIgKHVua25vd24gZW52XG4gICAgICAgICAgLy8gdmFycyBhcmUgaWdub3JlZCkuIFNlZSB0aGUgQmlsbGluZyBydW50aW1lIGFib3ZlIGZvciBkZXRhaWxzLlxuICAgICAgICAgIEZBU1RNQ1BfSFRUUF9IT1NUX09SSUdJTl9QUk9URUNUSU9OOiAnZmFsc2UnLFxuICAgICAgICAgIERFUExPWU1FTlRfVElNRVNUQU1QOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0sXG4gICAgICAgIFByb3RvY29sQ29uZmlndXJhdGlvbjogJ01DUCcsXG4gICAgICAgIExpZmVjeWNsZUNvbmZpZ3VyYXRpb246IHt9LFxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIGNmblByaWNpbmdNY3BSdW50aW1lLm5vZGUuYWRkRGVwZW5kZW5jeShwcmljaW5nTWNwUnVudGltZVJvbGUpO1xuXG4gICAgdGhpcy5wcmljaW5nTWNwUnVudGltZUFybiA9IGNmblByaWNpbmdNY3BSdW50aW1lLmdldEF0dCgnQWdlbnRSdW50aW1lQXJuJykudG9TdHJpbmcoKTtcbiAgICAvLyBNQ1AgUnVudGltZSBlbmRwb2ludCBmb3JtYXQgZm9yIEFnZW50Q29yZSBHYXRld2F5IHRhcmdldHMgKGZyb20gQVdTIGRvY3VtZW50YXRpb24pXG4gICAgLy8gRm9ybWF0OiBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLntyZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMve0VOQ09ERURfQVJOfS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVFxuICAgIC8vIFRoZSBBUk4gbXVzdCBiZSBVUkwtZW5jb2RlZCAoOiDihpIgJTNBLCAvIOKGkiAlMkYpXG4gICAgLy8gUmVmZXJlbmNlOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vYmVkcm9jay1hZ2VudGNvcmUvbGF0ZXN0L2Rldmd1aWRlL3J1bnRpbWUtbWNwLmh0bWxcbiAgICBjb25zdCBlbmNvZGVkUHJpY2luZ0FybiA9IGNkay5Gbi5qb2luKCcnLCBbXG4gICAgICBjZGsuRm4uc2VsZWN0KDAsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgxLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLnByaWNpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMiwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5wcmljaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDMsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCg0LCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLnByaWNpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5qb2luKCclMkYnLCBjZGsuRm4uc3BsaXQoJy8nLCBjZGsuRm4uc2VsZWN0KDUsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSkpLFxuICAgIF0pO1xuICAgIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCA9IGBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMvJHtlbmNvZGVkUHJpY2luZ0Fybn0vaW52b2NhdGlvbnM/cXVhbGlmaWVyPURFRkFVTFRgO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkV2F0Y2ggTUNQIFNlcnZlciBSdW50aW1lXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ2xvdWRXYXRjaCBNQ1AgU2VydmVyIFJ1bnRpbWUgUm9sZVxuICAgIGNvbnN0IGNsb3Vkd2F0Y2hNY3BSdW50aW1lUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQ2xvdWRXYXRjaE1jcFJ1bnRpbWVSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb21tb24gcGVybWlzc2lvbnMgdG8gQ2xvdWRXYXRjaCBydW50aW1lIHJvbGVcbiAgICBmb3IgKGNvbnN0IHN0bXQgb2YgY29tbW9uUnVudGltZVBlcm1pc3Npb25zKSB7XG4gICAgICBjbG91ZHdhdGNoTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3koc3RtdCk7XG4gICAgfVxuXG4gICAgLy8gRUNSIGltYWdlIHB1bGwgZm9yIENsb3VkV2F0Y2ggcmVwb3NpdG9yeVxuICAgIHByb3BzLmNsb3Vkd2F0Y2hNY3BSZXBvc2l0b3J5LmdyYW50UHVsbChjbG91ZHdhdGNoTWNwUnVudGltZVJvbGUpO1xuXG4gICAgLy8gR3JhbnQgQ2xvdWRXYXRjaCBhbmQgTG9ncyBSRUFELU9OTFkgcGVybWlzc2lvbnMuIFRoZSBDbG91ZFdhdGNoIE1DUFxuICAgIC8vIHNlcnZlciBvbmx5IHJlYWRzIG1ldHJpY3MvYWxhcm1zL2Rhc2hib2FyZHMvbG9nIGdyb3VwcyBhbmQgcnVucyBMb2dzXG4gICAgLy8gSW5zaWdodHMgcXVlcmllcywgc28gdGhpcyBpcyBzY29wZWQgdG8gRGVzY3JpYmUqL0dldCovTGlzdCogcGx1cyB0aGVcbiAgICAvLyAobm9uLWRlc3RydWN0aXZlKSBMb2dzIEluc2lnaHRzIHF1ZXJ5IHZlcmJzIOKAlCBubyBQdXQqL0RlbGV0ZSovQ3JlYXRlKi5cbiAgICAvLyBDbG91ZFdhdGNoL0xvZ3MgcmVhZCBBUElzIGFyZSBhY2NvdW50L3JlZ2lvbi1sZXZlbCBhbmQgZG8gbm90IHN1cHBvcnRcbiAgICAvLyByZXNvdXJjZS1sZXZlbCBBUk5zLCBzbyBSZXNvdXJjZTogJyonIGlzIHJlcXVpcmVkLlxuICAgIGNsb3Vkd2F0Y2hNY3BSdW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBzaWQ6ICdDbG91ZFdhdGNoQW5kTG9nc1JlYWRPbmx5JyxcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2Nsb3Vkd2F0Y2g6RGVzY3JpYmUqJyxcbiAgICAgICAgJ2Nsb3Vkd2F0Y2g6R2V0KicsXG4gICAgICAgICdjbG91ZHdhdGNoOkxpc3QqJyxcbiAgICAgICAgJ2xvZ3M6RGVzY3JpYmUqJyxcbiAgICAgICAgJ2xvZ3M6R2V0KicsXG4gICAgICAgICdsb2dzOkxpc3QqJyxcbiAgICAgICAgJ2xvZ3M6RmlsdGVyTG9nRXZlbnRzJyxcbiAgICAgICAgJ2xvZ3M6U3RhcnRRdWVyeScsXG4gICAgICAgICdsb2dzOlN0b3BRdWVyeScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIE1DUCBTZXJ2ZXIgUnVudGltZVxuICAgIGNvbnN0IGNmbkNsb3VkV2F0Y2hNY3BSdW50aW1lID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnQ2xvdWRXYXRjaE1jcFJ1bnRpbWUnLCB7XG4gICAgICB0eXBlOiAnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpSdW50aW1lJyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgQWdlbnRSdW50aW1lTmFtZTogJ2Nsb3Vkb3BzX2Nsb3Vkd2F0Y2hfbWNwX2p3dF92MScsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQVdTIExhYnMgQ2xvdWRXYXRjaCBNQ1AgU2VydmVyIFJ1bnRpbWUgd2l0aCBKV1QgYXV0aG9yaXphdGlvbicsXG4gICAgICAgIFJvbGVBcm46IGNsb3Vkd2F0Y2hNY3BSdW50aW1lUm9sZS5yb2xlQXJuLFxuICAgICAgICBBdXRob3JpemVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIEN1c3RvbUpXVEF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIEFsbG93ZWRDbGllbnRzOiBbcHJvcHMubTJtQ2xpZW50SWRdLFxuICAgICAgICAgICAgRGlzY292ZXJ5VXJsOiBgaHR0cHM6Ly9jb2duaXRvLWlkcC4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cHJvcHMudXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgQWdlbnRSdW50aW1lQXJ0aWZhY3Q6IHtcbiAgICAgICAgICBDb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJVcmk6IGAke3Byb3BzLmNsb3Vkd2F0Y2hNY3BSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGBcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIE5ldHdvcmtDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgTmV0d29ya01vZGU6ICdQVUJMSUMnXG4gICAgICAgIH0sXG4gICAgICAgIEVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgQVdTX1JFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgICAgREVQTE9ZTUVOVF9USU1FU1RBTVA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSxcbiAgICAgICAgUHJvdG9jb2xDb25maWd1cmF0aW9uOiAnTUNQJyxcbiAgICAgICAgTGlmZWN5Y2xlQ29uZmlndXJhdGlvbjoge30sXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjZm5DbG91ZFdhdGNoTWNwUnVudGltZS5ub2RlLmFkZERlcGVuZGVuY3koY2xvdWR3YXRjaE1jcFJ1bnRpbWVSb2xlKTtcblxuICAgIHRoaXMuY2xvdWR3YXRjaE1jcFJ1bnRpbWVBcm4gPSBjZm5DbG91ZFdhdGNoTWNwUnVudGltZS5nZXRBdHQoJ0FnZW50UnVudGltZUFybicpLnRvU3RyaW5nKCk7XG4gICAgLy8gTUNQIFJ1bnRpbWUgZW5kcG9pbnQgZm9ybWF0IGZvciBBZ2VudENvcmUgR2F0ZXdheSB0YXJnZXRzIChmcm9tIEFXUyBkb2N1bWVudGF0aW9uKVxuICAgIC8vIEZvcm1hdDogaHR0cHM6Ly9iZWRyb2NrLWFnZW50Y29yZS57cmVnaW9ufS5hbWF6b25hd3MuY29tL3J1bnRpbWVzL3tFTkNPREVEX0FSTn0vaW52b2NhdGlvbnM/cXVhbGlmaWVyPURFRkFVTFRcbiAgICAvLyBUaGUgQVJOIG11c3QgYmUgVVJMLWVuY29kZWQgKDog4oaSICUzQSwgLyDihpIgJTJGKVxuICAgIGNvbnN0IGVuY29kZWRDbG91ZFdhdGNoQXJuID0gY2RrLkZuLmpvaW4oJycsIFtcbiAgICAgIGNkay5Gbi5zZWxlY3QoMCwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5jbG91ZHdhdGNoTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDEsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuY2xvdWR3YXRjaE1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmNsb3Vkd2F0Y2hNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMywgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5jbG91ZHdhdGNoTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDQsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuY2xvdWR3YXRjaE1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLmpvaW4oJyUyRicsIGNkay5Gbi5zcGxpdCgnLycsIGNkay5Gbi5zZWxlY3QoNSwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5jbG91ZHdhdGNoTWNwUnVudGltZUFybikpKSksXG4gICAgXSk7XG4gICAgdGhpcy5jbG91ZHdhdGNoTWNwUnVudGltZUVuZHBvaW50ID0gYGh0dHBzOi8vYmVkcm9jay1hZ2VudGNvcmUuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS9ydW50aW1lcy8ke2VuY29kZWRDbG91ZFdhdGNoQXJufS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVGA7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ2xvdWRUcmFpbCBNQ1AgU2VydmVyIFJ1bnRpbWVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDbG91ZFRyYWlsIE1DUCBTZXJ2ZXIgUnVudGltZSBSb2xlXG4gICAgY29uc3QgY2xvdWR0cmFpbE1jcFJ1bnRpbWVSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDbG91ZFRyYWlsTWNwUnVudGltZVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbW1vbiBwZXJtaXNzaW9ucyB0byBDbG91ZFRyYWlsIHJ1bnRpbWUgcm9sZVxuICAgIGZvciAoY29uc3Qgc3RtdCBvZiBjb21tb25SdW50aW1lUGVybWlzc2lvbnMpIHtcbiAgICAgIGNsb3VkdHJhaWxNY3BSdW50aW1lUm9sZS5hZGRUb1BvbGljeShzdG10KTtcbiAgICB9XG5cbiAgICAvLyBFQ1IgaW1hZ2UgcHVsbCBmb3IgQ2xvdWRUcmFpbCByZXBvc2l0b3J5XG4gICAgcHJvcHMuY2xvdWR0cmFpbE1jcFJlcG9zaXRvcnkuZ3JhbnRQdWxsKGNsb3VkdHJhaWxNY3BSdW50aW1lUm9sZSk7XG5cbiAgICAvLyBDbG91ZFRyYWlsIHJlYWQtb25seSBhdWRpdCBwZXJtaXNzaW9ucy4gUmVzb3VyY2U6ICcqJyBpcyByZXF1aXJlZCBhbmRcbiAgICAvLyBjYW5ub3QgYmUgc2NvcGVkIHRvIHNwZWNpZmljIHRyYWlsIEFSTnM6IHRoZSBDbG91ZFRyYWlsIE1DUCBzZXJ2ZXIgcmVhZHNcbiAgICAvLyBFWElTVElORyBhY2NvdW50IHRyYWlscy9ldmVudHMgdGhhdCB0aGlzIHN0YWNrIGRvZXMgbm90IGNyZWF0ZSwgc28gdGhlXG4gICAgLy8gdHJhaWwgQVJOcyBhcmUgdW5rbm93biBhdCBkZXBsb3kgdGltZS4gTG9va3VwRXZlbnRzIGFuZCBMaXN0VHJhaWxzIGFyZVxuICAgIC8vIGFjY291bnQtbGV2ZWwgQVBJcyBieSBkZXNpZ247IHRoZSByZW1haW5pbmcgYWN0aW9ucyAoR2V0VHJhaWxTdGF0dXMsXG4gICAgLy8gRGVzY3JpYmVUcmFpbHMsIEdldEV2ZW50U2VsZWN0b3JzKSBhcmUgcmVhZC1vbmx5IGFuZCBkbyBub3QgZXhwb3NlXG4gICAgLy8gbXV0YXRpbmcgY2FwYWJpbGl0eS5cbiAgICBjbG91ZHRyYWlsTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnQ2xvdWRUcmFpbFJlYWRPbmx5QXVkaXQnLFxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnY2xvdWR0cmFpbDpMb29rdXBFdmVudHMnLFxuICAgICAgICAnY2xvdWR0cmFpbDpHZXRUcmFpbFN0YXR1cycsXG4gICAgICAgICdjbG91ZHRyYWlsOkRlc2NyaWJlVHJhaWxzJyxcbiAgICAgICAgJ2Nsb3VkdHJhaWw6R2V0RXZlbnRTZWxlY3RvcnMnLFxuICAgICAgICAnY2xvdWR0cmFpbDpMaXN0VHJhaWxzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIENsb3VkVHJhaWwgTUNQIFNlcnZlciBSdW50aW1lXG4gICAgY29uc3QgY2ZuQ2xvdWRUcmFpbE1jcFJ1bnRpbWUgPSBuZXcgY2RrLkNmblJlc291cmNlKHRoaXMsICdDbG91ZFRyYWlsTWNwUnVudGltZScsIHtcbiAgICAgIHR5cGU6ICdBV1M6OkJlZHJvY2tBZ2VudENvcmU6OlJ1bnRpbWUnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBBZ2VudFJ1bnRpbWVOYW1lOiAnY2xvdWRvcHNfY2xvdWR0cmFpbF9tY3Bfand0X3YxJyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdBV1MgTGFicyBDbG91ZFRyYWlsIE1DUCBTZXJ2ZXIgUnVudGltZSB3aXRoIEpXVCBhdXRob3JpemF0aW9uJyxcbiAgICAgICAgUm9sZUFybjogY2xvdWR0cmFpbE1jcFJ1bnRpbWVSb2xlLnJvbGVBcm4sXG4gICAgICAgIEF1dGhvcml6ZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgQ3VzdG9tSldUQXV0aG9yaXplcjoge1xuICAgICAgICAgICAgQWxsb3dlZENsaWVudHM6IFtwcm9wcy5tMm1DbGllbnRJZF0sXG4gICAgICAgICAgICBEaXNjb3ZlcnlVcmw6IGBodHRwczovL2NvZ25pdG8taWRwLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vJHtwcm9wcy51c2VyUG9vbElkfS8ud2VsbC1rbm93bi9vcGVuaWQtY29uZmlndXJhdGlvbmAsXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBBZ2VudFJ1bnRpbWVBcnRpZmFjdDoge1xuICAgICAgICAgIENvbnRhaW5lckNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgIENvbnRhaW5lclVyaTogYCR7cHJvcHMuY2xvdWR0cmFpbE1jcFJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaX06bGF0ZXN0YFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgTmV0d29ya0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBOZXR3b3JrTW9kZTogJ1BVQkxJQydcbiAgICAgICAgfSxcbiAgICAgICAgRW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICBBV1NfUkVHSU9OOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgICBERVBMT1lNRU5UX1RJTUVTVEFNUDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICB9LFxuICAgICAgICBQcm90b2NvbENvbmZpZ3VyYXRpb246ICdNQ1AnLFxuICAgICAgICBMaWZlY3ljbGVDb25maWd1cmF0aW9uOiB7fSxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNmbkNsb3VkVHJhaWxNY3BSdW50aW1lLm5vZGUuYWRkRGVwZW5kZW5jeShjbG91ZHRyYWlsTWNwUnVudGltZVJvbGUpO1xuXG4gICAgdGhpcy5jbG91ZHRyYWlsTWNwUnVudGltZUFybiA9IGNmbkNsb3VkVHJhaWxNY3BSdW50aW1lLmdldEF0dCgnQWdlbnRSdW50aW1lQXJuJykudG9TdHJpbmcoKTtcbiAgICAvLyBNQ1AgUnVudGltZSBlbmRwb2ludCBmb3JtYXQgZm9yIEFnZW50Q29yZSBHYXRld2F5IHRhcmdldHMgKGZyb20gQVdTIGRvY3VtZW50YXRpb24pXG4gICAgLy8gRm9ybWF0OiBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLntyZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMve0VOQ09ERURfQVJOfS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVFxuICAgIC8vIFRoZSBBUk4gbXVzdCBiZSBVUkwtZW5jb2RlZCAoOiDihpIgJTNBLCAvIOKGkiAlMkYpXG4gICAgLy8gUmVmZXJlbmNlOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vYmVkcm9jay1hZ2VudGNvcmUvbGF0ZXN0L2Rldmd1aWRlL3J1bnRpbWUtbWNwLmh0bWxcbiAgICBjb25zdCBlbmNvZGVkQ2xvdWRUcmFpbEFybiA9IGNkay5Gbi5qb2luKCcnLCBbXG4gICAgICBjZGsuRm4uc2VsZWN0KDAsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuY2xvdWR0cmFpbE1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgxLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmNsb3VkdHJhaWxNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMiwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5jbG91ZHRyYWlsTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDMsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuY2xvdWR0cmFpbE1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCg0LCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmNsb3VkdHJhaWxNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5qb2luKCclMkYnLCBjZGsuRm4uc3BsaXQoJy8nLCBjZGsuRm4uc2VsZWN0KDUsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuY2xvdWR0cmFpbE1jcFJ1bnRpbWVBcm4pKSkpLFxuICAgIF0pO1xuICAgIHRoaXMuY2xvdWR0cmFpbE1jcFJ1bnRpbWVFbmRwb2ludCA9IGBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMvJHtlbmNvZGVkQ2xvdWRUcmFpbEFybn0vaW52b2NhdGlvbnM/cXVhbGlmaWVyPURFRkFVTFRgO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIER5bmFtb0RCIEVPTCBTY2hlZHVsZXMgVGFibGUgKGNvbmRpdGlvbmFsKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBsZXQgZW9sVGFibGVOYW1lOiBzdHJpbmc7XG4gICAgaWYgKHByb3BzLmVvbFRhYmxlTmFtZSkge1xuICAgICAgLy8gVXNlIGV4aXN0aW5nIHRhYmxlIG5hbWVcbiAgICAgIGVvbFRhYmxlTmFtZSA9IHByb3BzLmVvbFRhYmxlTmFtZTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ3JlYXRlIG5ldyBEeW5hbW9EQiB0YWJsZVxuICAgICAgY29uc3QgZW9sVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0VvbFNjaGVkdWxlc1RhYmxlJywge1xuICAgICAgICB0YWJsZU5hbWU6ICdhd3MtZW9sLXNjaGVkdWxlcycsXG4gICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc2VydmljZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3ZlcnNpb24nLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICBwb2ludEluVGltZVJlY292ZXJ5U3BlY2lmaWNhdGlvbjogeyBwb2ludEluVGltZVJlY292ZXJ5RW5hYmxlZDogdHJ1ZSB9LFxuICAgICAgfSk7XG4gICAgICBlb2xUYWJsZU5hbWUgPSBlb2xUYWJsZS50YWJsZU5hbWU7XG4gICAgfVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEludmVudG9yeSBNQ1AgU2VydmVyIFJ1bnRpbWVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBJbnZlbnRvcnkgTUNQIFNlcnZlciBSdW50aW1lIFJvbGVcbiAgICBjb25zdCBpbnZlbnRvcnlNY3BSdW50aW1lUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnSW52ZW50b3J5TWNwUnVudGltZVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbW1vbiBwZXJtaXNzaW9ucyB0byBJbnZlbnRvcnkgcnVudGltZSByb2xlXG4gICAgZm9yIChjb25zdCBzdG10IG9mIGNvbW1vblJ1bnRpbWVQZXJtaXNzaW9ucykge1xuICAgICAgaW52ZW50b3J5TWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3koc3RtdCk7XG4gICAgfVxuXG4gICAgLy8gRUNSIGltYWdlIHB1bGwgZm9yIEludmVudG9yeSByZXBvc2l0b3J5XG4gICAgcHJvcHMuaW52ZW50b3J5TWNwUmVwb3NpdG9yeS5ncmFudFB1bGwoaW52ZW50b3J5TWNwUnVudGltZVJvbGUpO1xuXG4gICAgLy8gUmVhZC1vbmx5IGNyb3NzLXNlcnZpY2UgaW52ZW50b3J5IGRpc2NvdmVyeSAoRUtTLCBSRFMsIE9wZW5TZWFyY2gsXG4gICAgLy8gRWxhc3RpQ2FjaGUsIE1TSywgRUMyKS4gQWxsIGFjdGlvbnMgYXJlIExpc3QqL0Rlc2NyaWJlKiByZWFkcy4gVGhlc2VcbiAgICAvLyBEZXNjcmliZS9MaXN0IEFQSXMgZW51bWVyYXRlIHJlc291cmNlcyBhY2NvdW50L3JlZ2lvbi13aWRlIGFuZCBkbyBOT1RcbiAgICAvLyBzdXBwb3J0IHJlc291cmNlLWxldmVsIEFSTnMsIHNvIFJlc291cmNlOiAnKicgaXMgcmVxdWlyZWQgZm9yIHRoZVxuICAgIC8vIGludmVudG9yeSBzZXJ2ZXIgdG8gZGlzY292ZXIgY2x1c3RlcnMgYWNyb3NzIHRoZSBhY2NvdW50LiBObyBtdXRhdGluZ1xuICAgIC8vIChDcmVhdGUvTW9kaWZ5L0RlbGV0ZSkgYWN0aW9ucyBhcmUgZ3JhbnRlZC5cbiAgICBpbnZlbnRvcnlNY3BSdW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBzaWQ6ICdJbnZlbnRvcnlSZWFkT25seURpc2NvdmVyeScsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdla3M6TGlzdENsdXN0ZXJzJyxcbiAgICAgICAgJ2VrczpEZXNjcmliZUNsdXN0ZXInLFxuICAgICAgICAnZWtzOkxpc3ROb2RlZ3JvdXBzJyxcbiAgICAgICAgJ2VrczpEZXNjcmliZU5vZGVncm91cCcsXG4gICAgICAgICdyZHM6RGVzY3JpYmVEQkluc3RhbmNlcycsXG4gICAgICAgICdyZHM6RGVzY3JpYmVEQkNsdXN0ZXJzJyxcbiAgICAgICAgJ3JkczpEZXNjcmliZURCRW5naW5lVmVyc2lvbnMnLFxuICAgICAgICAnZXM6TGlzdERvbWFpbk5hbWVzJyxcbiAgICAgICAgJ2VzOkRlc2NyaWJlRG9tYWluJyxcbiAgICAgICAgJ2VzOkRlc2NyaWJlRG9tYWlucycsXG4gICAgICAgICdlbGFzdGljYWNoZTpEZXNjcmliZUNhY2hlQ2x1c3RlcnMnLFxuICAgICAgICAnZWxhc3RpY2FjaGU6RGVzY3JpYmVSZXBsaWNhdGlvbkdyb3VwcycsXG4gICAgICAgICdrYWZrYTpMaXN0Q2x1c3RlcnMnLFxuICAgICAgICAna2Fma2E6TGlzdENsdXN0ZXJzVjInLFxuICAgICAgICAna2Fma2E6RGVzY3JpYmVDbHVzdGVyJyxcbiAgICAgICAgJ2thZmthOkRlc2NyaWJlQ2x1c3RlclYyJyxcbiAgICAgICAgJ2VjMjpEZXNjcmliZVJlZ2lvbnMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gR3JhbnQgRHluYW1vREIgcmVhZCBhY2Nlc3Mgb24gRU9MIHRhYmxlXG4gICAgY29uc3QgZW9sVGFibGVBcm4gPSBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvJHtlb2xUYWJsZU5hbWV9YDtcbiAgICBpbnZlbnRvcnlNY3BSdW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdkeW5hbW9kYjpHZXRJdGVtJyxcbiAgICAgICAgJ2R5bmFtb2RiOlF1ZXJ5JyxcbiAgICAgICAgJ2R5bmFtb2RiOlNjYW4nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW2VvbFRhYmxlQXJuXSxcbiAgICB9KSk7XG5cbiAgICAvLyBJbnZlbnRvcnkgTUNQIFNlcnZlciBSdW50aW1lXG4gICAgY29uc3QgY2ZuSW52ZW50b3J5TWNwUnVudGltZSA9IG5ldyBjZGsuQ2ZuUmVzb3VyY2UodGhpcywgJ0ludmVudG9yeU1jcFJ1bnRpbWUnLCB7XG4gICAgICB0eXBlOiAnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpSdW50aW1lJyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgQWdlbnRSdW50aW1lTmFtZTogJ2Nsb3Vkb3BzX2ludmVudG9yeV9tY3Bfand0X3YxJyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdJbnZlbnRvcnkgTUNQIFNlcnZlciBSdW50aW1lIHdpdGggSldUIGF1dGhvcml6YXRpb24nLFxuICAgICAgICBSb2xlQXJuOiBpbnZlbnRvcnlNY3BSdW50aW1lUm9sZS5yb2xlQXJuLFxuICAgICAgICBBdXRob3JpemVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIEN1c3RvbUpXVEF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIEFsbG93ZWRDbGllbnRzOiBbcHJvcHMubTJtQ2xpZW50SWRdLFxuICAgICAgICAgICAgRGlzY292ZXJ5VXJsOiBgaHR0cHM6Ly9jb2duaXRvLWlkcC4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cHJvcHMudXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgQWdlbnRSdW50aW1lQXJ0aWZhY3Q6IHtcbiAgICAgICAgICBDb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJVcmk6IGAke3Byb3BzLmludmVudG9yeU1jcFJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaX06bGF0ZXN0YFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgTmV0d29ya0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBOZXR3b3JrTW9kZTogJ1BVQkxJQydcbiAgICAgICAgfSxcbiAgICAgICAgRW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICBBV1NfUkVHSU9OOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgICBFT0xfVEFCTEVfTkFNRTogZW9sVGFibGVOYW1lLFxuICAgICAgICAgIE1DUF9UUkFOU1BPUlQ6ICdzdHJlYW1hYmxlLWh0dHAnLFxuICAgICAgICAgIERFUExPWU1FTlRfVElNRVNUQU1QOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0sXG4gICAgICAgIFByb3RvY29sQ29uZmlndXJhdGlvbjogJ01DUCcsXG4gICAgICAgIExpZmVjeWNsZUNvbmZpZ3VyYXRpb246IHt9LFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY2ZuSW52ZW50b3J5TWNwUnVudGltZS5ub2RlLmFkZERlcGVuZGVuY3koaW52ZW50b3J5TWNwUnVudGltZVJvbGUpO1xuXG4gICAgdGhpcy5pbnZlbnRvcnlNY3BSdW50aW1lQXJuID0gY2ZuSW52ZW50b3J5TWNwUnVudGltZS5nZXRBdHQoJ0FnZW50UnVudGltZUFybicpLnRvU3RyaW5nKCk7XG4gICAgLy8gTUNQIFJ1bnRpbWUgZW5kcG9pbnQgZm9ybWF0IGZvciBBZ2VudENvcmUgR2F0ZXdheSB0YXJnZXRzIChmcm9tIEFXUyBkb2N1bWVudGF0aW9uKVxuICAgIC8vIEZvcm1hdDogaHR0cHM6Ly9iZWRyb2NrLWFnZW50Y29yZS57cmVnaW9ufS5hbWF6b25hd3MuY29tL3J1bnRpbWVzL3tFTkNPREVEX0FSTn0vaW52b2NhdGlvbnM/cXVhbGlmaWVyPURFRkFVTFRcbiAgICAvLyBUaGUgQVJOIG11c3QgYmUgVVJMLWVuY29kZWQgKDog4oaSICUzQSwgLyDihpIgJTJGKVxuICAgIGNvbnN0IGVuY29kZWRJbnZlbnRvcnlBcm4gPSBjZGsuRm4uam9pbignJywgW1xuICAgICAgY2RrLkZuLnNlbGVjdCgwLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmludmVudG9yeU1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgxLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmludmVudG9yeU1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmludmVudG9yeU1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgzLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmludmVudG9yeU1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCg0LCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmludmVudG9yeU1jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLmpvaW4oJyUyRicsIGNkay5Gbi5zcGxpdCgnLycsIGNkay5Gbi5zZWxlY3QoNSwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5pbnZlbnRvcnlNY3BSdW50aW1lQXJuKSkpKSxcbiAgICBdKTtcbiAgICB0aGlzLmludmVudG9yeU1jcFJ1bnRpbWVFbmRwb2ludCA9IGBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMvJHtlbmNvZGVkSW52ZW50b3J5QXJufS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVGA7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRU9MIFNjcmFwZXIgTGFtYmRhIEZ1bmN0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgZW9sU2NyYXBlclBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vbWNwLXNlcnZlcnMvaW52ZW50b3J5L2VvbC1zY3JhcGVyJyk7XG4gICAgY29uc3QgZW9sU2NyYXBlckZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRW9sU2NyYXBlckZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tRW9sU2NyYXBlcmAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMixcbiAgICAgIGhhbmRsZXI6ICdlb2xfc2NyYXBlci5tYWluLmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGVvbFNjcmFwZXJQYXRoLCB7XG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgaW1hZ2U6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEyLmJ1bmRsaW5nSW1hZ2UsXG4gICAgICAgICAgY29tbWFuZDogW1xuICAgICAgICAgICAgJ2Jhc2gnLCAnLWMnLFxuICAgICAgICAgICAgLy8gLS1uby13YXJuLWNvbmZsaWN0czogdGhlIHNjcmFwZXIncyBkZXBzIChib3RvMy9yZXF1ZXN0cy9iczQpIGFyZVxuICAgICAgICAgICAgLy8gcHVyZS1QeXRob24gYW5kIGluc3RhbGwgY2xlYW5seSBpbnRvIHRoZSBhc3NldCBkaXI7IHRoZSBmbGFnIGp1c3RcbiAgICAgICAgICAgIC8vIHN1cHByZXNzZXMgcGlwJ3Mgbm9pc3kgbm90aWNlIGFib3V0IFVOUkVMQVRFRCBwYWNrYWdlcyB0aGF0IGhhcHBlblxuICAgICAgICAgICAgLy8gdG8gYmUgcHJlc2VudCBpbiB0aGUgc3Vycm91bmRpbmcgZW52aXJvbm1lbnQuXG4gICAgICAgICAgICAncGlwIGluc3RhbGwgLXIgcmVxdWlyZW1lbnRzLnR4dCAtdCAvYXNzZXQtb3V0cHV0IC0tbm8td2Fybi1jb25mbGljdHMgJiYgY3AgLWF1IC4gL2Fzc2V0LW91dHB1dCcsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIC8vIFVzZSBleGVjRmlsZVN5bmMgd2l0aCBhbiBleHBsaWNpdCBhcmd1bWVudCB2ZWN0b3IgKE5PVCBhIHNoZWxsXG4gICAgICAgICAgICAgIC8vIHN0cmluZykgc28gbm8gc2hlbGwgaXMgc3Bhd25lZCBhbmQgdGhlcmUgaXMgbm8gY29tbWFuZC1pbmplY3Rpb25cbiAgICAgICAgICAgICAgLy8gc3VyZmFjZSDigJQgaW5wdXRzIGFyZSBDREstY29udHJvbGxlZCBidWlsZCBwYXRocyByZWdhcmRsZXNzLlxuICAgICAgICAgICAgICAvLyAtLW5vLXdhcm4tY29uZmxpY3RzIHNpbGVuY2VzIHBpcCdzIFwiZGVwZW5kZW5jeSByZXNvbHZlciBkb2VzIG5vdFxuICAgICAgICAgICAgICAvLyBjdXJyZW50bHkgdGFrZSBpbnRvIGFjY291bnQuLi5cIiBub3RpY2UgKHRyaWdnZXJlZCBieSB1bnJlbGF0ZWRcbiAgICAgICAgICAgICAgLy8gcGFja2FnZXMgaW4gdGhlIGhvc3QgUHl0aG9uIGVudiwgbm90IHRoZSBzY3JhcGVyJ3MgZGVwcykuXG4gICAgICAgICAgICAgIGNvbnN0IHsgZXhlY0ZpbGVTeW5jIH0gPSByZXF1aXJlKCdjaGlsZF9wcm9jZXNzJyk7XG4gICAgICAgICAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBleGVjRmlsZVN5bmMoXG4gICAgICAgICAgICAgICAgICAncHl0aG9uMycsXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICctbScsICdwaXAnLCAnaW5zdGFsbCcsXG4gICAgICAgICAgICAgICAgICAgICctcicsIGAke2VvbFNjcmFwZXJQYXRofS9yZXF1aXJlbWVudHMudHh0YCxcbiAgICAgICAgICAgICAgICAgICAgJy10Jywgb3V0cHV0RGlyLFxuICAgICAgICAgICAgICAgICAgICAnLS1xdWlldCcsICctLW5vLXdhcm4tY29uZmxpY3RzJyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICB7IHN0ZGlvOiAnaWdub3JlJyB9LFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgLy8gQ29weSB0aGUgcGFja2FnZSBzb3VyY2Ugd2l0aCB0aGUgTm9kZSBmcyBBUEkg4oCUIG5vIHN1YnByb2Nlc3MuXG4gICAgICAgICAgICAgICAgZnMuY3BTeW5jKGAke2VvbFNjcmFwZXJQYXRofS9lb2xfc2NyYXBlcmAsIGAke291dHB1dERpcn0vZW9sX3NjcmFwZXJgLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRU9MX1RBQkxFX05BTUU6IGVvbFRhYmxlTmFtZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBEeW5hbW9EQiB3cml0ZSBwZXJtaXNzaW9ucyB0byBMYW1iZGFcbiAgICBlb2xTY3JhcGVyRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxuICAgICAgICAnZHluYW1vZGI6QmF0Y2hXcml0ZUl0ZW0nLFxuICAgICAgICAnZHluYW1vZGI6Q3JlYXRlVGFibGUnLFxuICAgICAgICAnZHluYW1vZGI6RGVzY3JpYmVUYWJsZScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbZW9sVGFibGVBcm5dLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IEVLUyBEZXNjcmliZUNsdXN0ZXJWZXJzaW9ucyBwZXJtaXNzaW9uXG4gICAgZW9sU2NyYXBlckZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdla3M6RGVzY3JpYmVDbHVzdGVyVmVyc2lvbnMnLFxuICAgICAgICAnZXM6TGlzdFZlcnNpb25zJyxcbiAgICAgICAgJ2VzOkxpc3RFbGFzdGljc2VhcmNoVmVyc2lvbnMnLFxuICAgICAgICAnZWxhc3RpY2FjaGU6RGVzY3JpYmVDYWNoZUVuZ2luZVZlcnNpb25zJyxcbiAgICAgICAgJ2thZmthOkdldENvbXBhdGlibGVLYWZrYVZlcnNpb25zJyxcbiAgICAgICAgJ3JkczpEZXNjcmliZURCRW5naW5lVmVyc2lvbnMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gRXZlbnRCcmlkZ2UgcnVsZSB0byB0cmlnZ2VyIExhbWJkYSBkYWlseVxuICAgIGNvbnN0IGVvbFNjcmFwZXJTY2hlZHVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnRW9sU2NyYXBlclNjaGVkdWxlJywge1xuICAgICAgcnVsZU5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1Fb2xTY3JhcGVyRGFpbHlTY2hlZHVsZWAsXG4gICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLnJhdGUoY2RrLkR1cmF0aW9uLmRheXMoMSkpLFxuICAgIH0pO1xuICAgIGVvbFNjcmFwZXJTY2hlZHVsZS5hZGRUYXJnZXQobmV3IGV2ZW50c190YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGVvbFNjcmFwZXJGdW5jdGlvbikpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBUaGUgRU9MIHNjcmFwZXIgcnVucyBvbiBhIERBSUxZIHNjaGVkdWxlLCBzbyB0aGUgRU9MIHRhYmxlIGlzIEVNUFRZIHVudGlsXG4gICAgLy8gdGhlIGZpcnN0IHNjaGVkdWxlZCBydW4uIEFmdGVyIGRlcGxveW1lbnQsIGludm9rZSBpdCBvbmNlIG1hbnVhbGx5IHRvXG4gICAgLy8gcG9wdWxhdGUgdGhlIHRhYmxlIGltbWVkaWF0ZWx5IChzZWUgUkVBRE1FIFwiUG9wdWxhdGUgdGhlIEVPTCBkYXRhXCIpLlxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFb2xTY3JhcGVyRnVuY3Rpb25OYW1lJywge1xuICAgICAgdmFsdWU6IGVvbFNjcmFwZXJGdW5jdGlvbi5mdW5jdGlvbk5hbWUsXG4gICAgICAvLyBOT1RFOiBhbiBPdXRwdXQgRGVzY3JpcHRpb24gbXVzdCBiZSBhIGxpdGVyYWwgc3RyaW5nIOKAlCBkbyBOT1QgaW50ZXJwb2xhdGVcbiAgICAgIC8vIENESyB0b2tlbnMgKGUuZy4gZnVuY3Rpb25OYW1lL3JlZ2lvbikgaGVyZSwgb3IgQ2xvdWRGb3JtYXRpb24gcmVuZGVycyBpdFxuICAgICAgLy8gYXMgYW4gRm46OkpvaW4gYW5kIHJlamVjdHMgdGhlIHRlbXBsYXRlIChcIkV2ZXJ5IERlc2NyaXB0aW9uIG1lbWJlciBtdXN0XG4gICAgICAvLyBiZSBhIHN0cmluZ1wiKS4gVGhlIGZ1bmN0aW9uIG5hbWUgaXMgY2FycmllZCBpbiBgdmFsdWVgOyBpbnZva2Ugd2l0aDpcbiAgICAgIC8vICAgYXdzIGxhbWJkYSBpbnZva2UgLS1mdW5jdGlvbi1uYW1lIDx2YWx1ZT4gLS1yZWdpb24gPHJlZ2lvbj4gL2Rldi9zdGRvdXRcbiAgICAgIGRlc2NyaXB0aW9uOiAnRU9MIHNjcmFwZXIgTGFtYmRhIG5hbWUg4oCUIGludm9rZSBvbmNlIGFmdGVyIGRlcGxveSB0byBwb3B1bGF0ZSB0aGUgRU9MIHRhYmxlIChzZWUgUkVBRE1FKS4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUVvbFNjcmFwZXJGdW5jdGlvbk5hbWVgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JpbGxpbmdNY3BSdW50aW1lQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuYmlsbGluZ01jcFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0JpbGxpbmcgTUNQIFNlcnZlciBSdW50aW1lIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQmlsbGluZ01jcFJ1bnRpbWVBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5iaWxsaW5nTWNwUnVudGltZUVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdCaWxsaW5nIE1DUCBTZXJ2ZXIgUnVudGltZSBFbmRwb2ludCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQmlsbGluZ01jcFJ1bnRpbWVFbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUHJpY2luZ01jcFJ1bnRpbWVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5wcmljaW5nTWNwUnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHJpY2luZyBNQ1AgU2VydmVyIFJ1bnRpbWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1QcmljaW5nTWNwUnVudGltZUFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnByaWNpbmdNY3BSdW50aW1lRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ByaWNpbmcgTUNQIFNlcnZlciBSdW50aW1lIEVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1QcmljaW5nTWNwUnVudGltZUVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbG91ZFdhdGNoTWNwUnVudGltZUFybk91dHB1dCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNsb3Vkd2F0Y2hNY3BSdW50aW1lQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIE1DUCBTZXJ2ZXIgUnVudGltZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUNsb3VkV2F0Y2hNY3BSdW50aW1lQXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbG91ZFdhdGNoTWNwUnVudGltZUVuZHBvaW50T3V0cHV0Jywge1xuICAgICAgdmFsdWU6IHRoaXMuY2xvdWR3YXRjaE1jcFJ1bnRpbWVFbmRwb2ludCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRXYXRjaCBNQ1AgU2VydmVyIFJ1bnRpbWUgRW5kcG9pbnQnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUNsb3VkV2F0Y2hNY3BSdW50aW1lRW5kcG9pbnRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkVHJhaWxNY3BSdW50aW1lQXJuT3V0cHV0Jywge1xuICAgICAgdmFsdWU6IHRoaXMuY2xvdWR0cmFpbE1jcFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkVHJhaWwgTUNQIFNlcnZlciBSdW50aW1lIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQ2xvdWRUcmFpbE1jcFJ1bnRpbWVBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkVHJhaWxNY3BSdW50aW1lRW5kcG9pbnRPdXRwdXQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jbG91ZHRyYWlsTWNwUnVudGltZUVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFRyYWlsIE1DUCBTZXJ2ZXIgUnVudGltZSBFbmRwb2ludCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQ2xvdWRUcmFpbE1jcFJ1bnRpbWVFbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSW52ZW50b3J5TWNwUnVudGltZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmludmVudG9yeU1jcFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0ludmVudG9yeSBNQ1AgU2VydmVyIFJ1bnRpbWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1JbnZlbnRvcnlNY3BSdW50aW1lQXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbnZlbnRvcnlNY3BSdW50aW1lRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5pbnZlbnRvcnlNY3BSdW50aW1lRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0ludmVudG9yeSBNQ1AgU2VydmVyIFJ1bnRpbWUgRW5kcG9pbnQnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUludmVudG9yeU1jcFJ1bnRpbWVFbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ0RLLU5hZyBTdXBwcmVzc2lvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoYmlsbGluZ01jcFJ1bnRpbWVSb2xlLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdXaWxkY2FyZCBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgQ29zdCBFeHBsb3JlciBBUElzIChhY2NvdW50LWxldmVsIHNlcnZpY2VzKSwgRUNSIGF1dGggdG9rZW4sIENsb3VkV2F0Y2gsIFgtUmF5JyxcbiAgICAgIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMocHJpY2luZ01jcFJ1bnRpbWVSb2xlLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdXaWxkY2FyZCBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgQVdTIFByaWNpbmcgQVBJIChnbG9iYWwgc2VydmljZSksIEVDUiBhdXRoIHRva2VuLCBDbG91ZFdhdGNoLCBYLVJheScsXG4gICAgICB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGNsb3Vkd2F0Y2hNY3BSdW50aW1lUm9sZSwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIENsb3VkV2F0Y2ggYW5kIExvZ3MgQVBJcyAoYWNjb3VudC1sZXZlbCBzZXJ2aWNlcyksIEVDUiBhdXRoIHRva2VuJyxcbiAgICAgIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoY2xvdWR0cmFpbE1jcFJ1bnRpbWVSb2xlLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdXaWxkY2FyZCBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgQ2xvdWRUcmFpbCBBUElzIChhY2NvdW50LWxldmVsIHNlcnZpY2VzKSwgRUNSIGF1dGggdG9rZW4nLFxuICAgICAgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhpbnZlbnRvcnlNY3BSdW50aW1lUm9sZSwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIEVLUywgUkRTLCBPcGVuU2VhcmNoLCBFbGFzdGlDYWNoZSwgTVNLIHJlYWQtb25seSBBUElzIChhY2NvdW50LWxldmVsIHNlcnZpY2VzKSwgRUNSIGF1dGggdG9rZW4nLFxuICAgICAgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhlb2xTY3JhcGVyRnVuY3Rpb24sIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1dpbGRjYXJkIHBlcm1pc3Npb25zIHJlcXVpcmVkIGZvciBFS1MgRGVzY3JpYmVDbHVzdGVyVmVyc2lvbnMgKGFjY291bnQtbGV2ZWwgQVBJKScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgcmVhc29uOiAnQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlIG1hbmFnZWQgcG9saWN5IGlzIEFXUyBiZXN0IHByYWN0aWNlIGZvciBMYW1iZGEgZnVuY3Rpb25zJyxcbiAgICAgIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkU3RhY2tTdXBwcmVzc2lvbnModGhpcywgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1MMScsXG4gICAgICAgIHJlYXNvbjogJ1B5dGhvbiAzLjE0IGlzIHRoZSBsYXRlc3QgTGFtYmRhIHJ1bnRpbWUgdmVyc2lvbiBhdmFpbGFibGUnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgIHJlYXNvbjogJ0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBtYW5hZ2VkIHBvbGljeSBpcyBBV1MgYmVzdCBwcmFjdGljZSBmb3IgTGFtYmRhIGZ1bmN0aW9ucycsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIGN1c3RvbSByZXNvdXJjZSBMYW1iZGEgZnVuY3Rpb25zJyxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==