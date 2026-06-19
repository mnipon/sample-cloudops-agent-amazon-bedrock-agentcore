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
exports.ImageStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const codebuild = __importStar(require("aws-cdk-lib/aws-codebuild"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const s3deploy = __importStar(require("aws-cdk-lib/aws-s3-deployment"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const path = __importStar(require("path"));
const cdk_nag_1 = require("cdk-nag");
/**
 * ImageStack: Builds Docker images for MCP server runtimes using the
 * stdio-to-HTTP patching pattern.
 *
 * For each MCP server (billing, pricing):
 *   1. CodeBuild clones the upstream AWS Labs MCP repo
 *   2. patch-{server}.sh patches server.py for streamable-http transport
 *   3. Adds uvicorn + starlette dependencies
 *   4. Patches Dockerfile (EXPOSE 8000, entrypoint, healthcheck)
 *   5. Builds ARM64 Docker image and pushes to ECR
 *
 * Based on: https://github.com/aws-samples/sample-aws-stdio-http-proxy-mcp
 */
class ImageStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ECR Repository for Main Agent Runtime image
        this.repository = new ecr.Repository(this, 'RuntimeRepository', {
            repositoryName: 'cloudops-agent-runtime',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            imageScanOnPush: true,
            lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
        });
        // ECR Repository for Billing MCP Server Runtime
        this.billingMcpRepository = new ecr.Repository(this, 'BillingMcpRepository', {
            repositoryName: 'cloudops-billing-mcp-runtime',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            imageScanOnPush: true,
            lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
        });
        // ECR Repository for Pricing MCP Server Runtime
        this.pricingMcpRepository = new ecr.Repository(this, 'PricingMcpRepository', {
            repositoryName: 'cloudops-pricing-mcp-runtime',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            imageScanOnPush: true,
            lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
        });
        // ECR Repository for CloudWatch MCP Server Runtime
        this.cloudwatchMcpRepository = new ecr.Repository(this, 'CloudWatchMcpRepository', {
            repositoryName: 'cloudops-cloudwatch-mcp-runtime',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            imageScanOnPush: true,
            lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
        });
        // ECR Repository for CloudTrail MCP Server Runtime
        this.cloudtrailMcpRepository = new ecr.Repository(this, 'CloudTrailMcpRepository', {
            repositoryName: 'cloudops-cloudtrail-mcp-runtime',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            imageScanOnPush: true,
            lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
        });
        // ECR Repository for Inventory MCP Server Runtime
        this.inventoryMcpRepository = new ecr.Repository(this, 'InventoryMcpRepository', {
            repositoryName: 'cloudops-inventory-mcp-runtime',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            imageScanOnPush: true,
            lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
        });
        // S3 Bucket for CodeBuild source (buildspec + patch scripts)
        this.sourceBucket = new s3.Bucket(this, 'SourceBucket', {
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            lifecycleRules: [
                { id: 'DeleteOldVersions', enabled: true, noncurrentVersionExpiration: cdk.Duration.days(30) },
            ],
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        // Upload codebuild-scripts to S3
        const scriptsDeployment = new s3deploy.BucketDeployment(this, 'CodeBuildScriptsDeployment', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../../codebuild-scripts'))],
            destinationBucket: this.sourceBucket,
            destinationKeyPrefix: 'codebuild-scripts/',
            extract: true,
            prune: false,
            retainOnDelete: false,
            memoryLimit: 512,
        });
        // Also upload agentcore directory for main runtime build
        const agentcoreDeployment = new s3deploy.BucketDeployment(this, 'AgentcoreSourceDeployment', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../../agentcore'))],
            destinationBucket: this.sourceBucket,
            destinationKeyPrefix: 'agentcore/',
        });
        // Upload inventory MCP server source to S3
        const inventorySourceDeployment = new s3deploy.BucketDeployment(this, 'InventorySourceDeployment', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../../mcp-servers/inventory'))],
            destinationBucket: this.sourceBucket,
            destinationKeyPrefix: 'inventory/',
        });
        // --- Build Trigger Lambda ---
        const buildTriggerFn = new lambda.Function(this, 'BuildTriggerFunction', {
            runtime: lambda.Runtime.PYTHON_3_14,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-trigger')),
            timeout: cdk.Duration.minutes(1),
            memorySize: 128,
            description: 'Triggers CodeBuild build for MCP server container',
        });
        // --- Build Waiter Lambda ---
        const buildWaiterFn = new lambda.Function(this, 'BuildWaiterFunction', {
            runtime: lambda.Runtime.PYTHON_3_14,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-waiter')),
            timeout: cdk.Duration.minutes(15),
            memorySize: 256,
            description: 'Polls CodeBuild build status until completion',
        });
        // ========================================
        // Billing MCP Server - CodeBuild + Transform
        // ========================================
        const billingBuildProject = this.createTransformBuildProject('BillingMcp', this.billingMcpRepository, 'codebuild-scripts/', 'buildspec-billing.yml');
        billingBuildProject.node.addDependency(scriptsDeployment);
        // Grant Lambda permissions
        buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:StartBuild'],
            resources: [billingBuildProject.projectArn],
        }));
        buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:BatchGetBuilds'],
            resources: [billingBuildProject.projectArn],
        }));
        // Trigger billing build
        const billingBuildTrigger = new cdk.CustomResource(this, 'BillingBuildTrigger', {
            serviceToken: buildTriggerFn.functionArn,
            properties: {
                ProjectName: billingBuildProject.projectName,
                Timestamp: new Date().toISOString(),
            },
        });
        billingBuildTrigger.node.addDependency(scriptsDeployment);
        // Wait for billing build
        const billingBuildWaiter = new cdk.CustomResource(this, 'BillingBuildWaiter', {
            serviceToken: buildWaiterFn.functionArn,
            properties: {
                BuildId: billingBuildTrigger.getAttString('BuildId'),
                MaxWaitSeconds: '1200',
            },
        });
        billingBuildWaiter.node.addDependency(billingBuildTrigger);
        // ========================================
        // Pricing MCP Server - CodeBuild + Transform
        // ========================================
        const pricingBuildProject = this.createTransformBuildProject('PricingMcp', this.pricingMcpRepository, 'codebuild-scripts/', 'buildspec-pricing.yml');
        pricingBuildProject.node.addDependency(scriptsDeployment);
        // Grant Lambda permissions for pricing
        buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:StartBuild'],
            resources: [pricingBuildProject.projectArn],
        }));
        buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:BatchGetBuilds'],
            resources: [pricingBuildProject.projectArn],
        }));
        // Trigger pricing build
        const pricingBuildTrigger = new cdk.CustomResource(this, 'PricingBuildTrigger', {
            serviceToken: buildTriggerFn.functionArn,
            properties: {
                ProjectName: pricingBuildProject.projectName,
                Timestamp: new Date().toISOString(),
            },
        });
        pricingBuildTrigger.node.addDependency(scriptsDeployment);
        // Wait for pricing build
        const pricingBuildWaiter = new cdk.CustomResource(this, 'PricingBuildWaiter', {
            serviceToken: buildWaiterFn.functionArn,
            properties: {
                BuildId: pricingBuildTrigger.getAttString('BuildId'),
                MaxWaitSeconds: '1200',
            },
        });
        pricingBuildWaiter.node.addDependency(pricingBuildTrigger);
        // ========================================
        // CloudWatch MCP Server - CodeBuild + Transform
        // ========================================
        const cloudwatchBuildProject = this.createTransformBuildProject('CloudWatchMcp', this.cloudwatchMcpRepository, 'codebuild-scripts/', 'buildspec-cloudwatch.yml');
        cloudwatchBuildProject.node.addDependency(scriptsDeployment);
        // Grant Lambda permissions for CloudWatch
        buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:StartBuild'],
            resources: [cloudwatchBuildProject.projectArn],
        }));
        buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:BatchGetBuilds'],
            resources: [cloudwatchBuildProject.projectArn],
        }));
        // Trigger CloudWatch build
        const cloudwatchBuildTrigger = new cdk.CustomResource(this, 'CloudWatchBuildTrigger', {
            serviceToken: buildTriggerFn.functionArn,
            properties: {
                ProjectName: cloudwatchBuildProject.projectName,
                Timestamp: new Date().toISOString(),
            },
        });
        cloudwatchBuildTrigger.node.addDependency(scriptsDeployment);
        // Wait for CloudWatch build
        const cloudwatchBuildWaiter = new cdk.CustomResource(this, 'CloudWatchBuildWaiter', {
            serviceToken: buildWaiterFn.functionArn,
            properties: {
                BuildId: cloudwatchBuildTrigger.getAttString('BuildId'),
                MaxWaitSeconds: '1200',
            },
        });
        cloudwatchBuildWaiter.node.addDependency(cloudwatchBuildTrigger);
        // ========================================
        // CloudTrail MCP Server - CodeBuild + Transform
        // ========================================
        const cloudtrailBuildProject = this.createTransformBuildProject('CloudTrailMcp', this.cloudtrailMcpRepository, 'codebuild-scripts/', 'buildspec-cloudtrail.yml');
        cloudtrailBuildProject.node.addDependency(scriptsDeployment);
        // Grant Lambda permissions for CloudTrail
        buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:StartBuild'],
            resources: [cloudtrailBuildProject.projectArn],
        }));
        buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:BatchGetBuilds'],
            resources: [cloudtrailBuildProject.projectArn],
        }));
        // Trigger CloudTrail build
        const cloudtrailBuildTrigger = new cdk.CustomResource(this, 'CloudTrailBuildTrigger', {
            serviceToken: buildTriggerFn.functionArn,
            properties: {
                ProjectName: cloudtrailBuildProject.projectName,
                Timestamp: new Date().toISOString(),
            },
        });
        cloudtrailBuildTrigger.node.addDependency(scriptsDeployment);
        // Wait for CloudTrail build
        const cloudtrailBuildWaiter = new cdk.CustomResource(this, 'CloudTrailBuildWaiter', {
            serviceToken: buildWaiterFn.functionArn,
            properties: {
                BuildId: cloudtrailBuildTrigger.getAttString('BuildId'),
                MaxWaitSeconds: '1200',
            },
        });
        cloudtrailBuildWaiter.node.addDependency(cloudtrailBuildTrigger);
        // ========================================
        // Inventory MCP Server - Direct Docker Build
        // ========================================
        const inventoryBuildRole = new iam.Role(this, 'InventoryMcpCodeBuildRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
            description: 'IAM role for CodeBuild to build Inventory MCP container image',
            inlinePolicies: {
                CloudWatchLogsPolicy: new iam.PolicyDocument({
                    statements: [new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                            resources: [`arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/codebuild/*`],
                        })],
                }),
                ECRPushPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage',
                                'ecr:PutImage', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload',
                            ],
                            resources: [this.inventoryMcpRepository.repositoryArn],
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['ecr:GetAuthorizationToken'],
                            resources: ['*'],
                        }),
                    ],
                }),
                S3ReadPolicy: new iam.PolicyDocument({
                    statements: [new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['s3:GetObject', 's3:GetObjectVersion'],
                            resources: [this.sourceBucket.arnForObjects('*')],
                        })],
                }),
            },
        });
        const inventoryBuildProject = new codebuild.Project(this, 'InventoryMcpBuildProject', {
            projectName: 'cloudops-inventorymcp-build',
            description: 'Build ARM64 container for Inventory MCP server',
            source: codebuild.Source.s3({
                bucket: this.sourceBucket,
                path: 'inventory/',
            }),
            environment: {
                buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
                computeType: codebuild.ComputeType.SMALL,
                privileged: true,
                environmentVariables: {
                    AWS_DEFAULT_REGION: { value: cdk.Aws.REGION },
                    AWS_ACCOUNT_ID: { value: cdk.Aws.ACCOUNT_ID },
                    ECR_REPO_URI: { value: this.inventoryMcpRepository.repositoryUri },
                },
            },
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {
                        commands: [
                            'echo "=== Phase Pre-build - ECR Login ==="',
                            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
                        ],
                    },
                    build: {
                        commands: [
                            'echo "=== Phase Build - Docker image ==="',
                            'docker build -t $ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER .',
                            'docker tag $ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER $ECR_REPO_URI:latest',
                        ],
                    },
                    post_build: {
                        commands: [
                            'echo "=== Phase Post-build - Push to ECR ==="',
                            'docker push $ECR_REPO_URI:$CODEBUILD_BUILD_NUMBER',
                            'docker push $ECR_REPO_URI:latest',
                            'echo "Inventory MCP image pushed successfully."',
                        ],
                    },
                },
            }),
            role: inventoryBuildRole,
            timeout: cdk.Duration.minutes(30),
        });
        inventoryBuildProject.node.addDependency(inventorySourceDeployment);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(inventoryBuildRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ecr:GetAuthorizationToken, S3, CloudWatch Logs.' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(inventoryBuildProject, [
            { id: 'AwsSolutions-CB4', reason: 'KMS encryption not enabled for dev/demo.' },
        ]);
        // Grant Lambda permissions for Inventory
        buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:StartBuild'],
            resources: [inventoryBuildProject.projectArn],
        }));
        buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:BatchGetBuilds'],
            resources: [inventoryBuildProject.projectArn],
        }));
        // Trigger Inventory build
        const inventoryBuildTrigger = new cdk.CustomResource(this, 'InventoryBuildTrigger', {
            serviceToken: buildTriggerFn.functionArn,
            properties: {
                ProjectName: inventoryBuildProject.projectName,
                Timestamp: new Date().toISOString(),
            },
        });
        inventoryBuildTrigger.node.addDependency(inventorySourceDeployment);
        // Wait for Inventory build
        const inventoryBuildWaiter = new cdk.CustomResource(this, 'InventoryBuildWaiter', {
            serviceToken: buildWaiterFn.functionArn,
            properties: {
                BuildId: inventoryBuildTrigger.getAttString('BuildId'),
                MaxWaitSeconds: '1200',
            },
        });
        inventoryBuildWaiter.node.addDependency(inventoryBuildTrigger);
        // ========================================
        // Main Agent Runtime - Standard Docker Build
        // ========================================
        this.buildMainRuntimeImage(agentcoreDeployment);
        // ========================================
        // Outputs
        // ========================================
        new cdk.CfnOutput(this, 'MainRepositoryUri', {
            value: this.repository.repositoryUri,
            description: 'Main Runtime ECR Repository URI',
            exportName: `${this.stackName}-MainRepositoryUri`,
        });
        new cdk.CfnOutput(this, 'BillingMcpRepositoryUri', {
            value: this.billingMcpRepository.repositoryUri,
            description: 'Billing MCP Runtime ECR Repository URI',
            exportName: `${this.stackName}-BillingMcpRepositoryUri`,
        });
        new cdk.CfnOutput(this, 'PricingMcpRepositoryUri', {
            value: this.pricingMcpRepository.repositoryUri,
            description: 'Pricing MCP Runtime ECR Repository URI',
            exportName: `${this.stackName}-PricingMcpRepositoryUri`,
        });
        new cdk.CfnOutput(this, 'CloudWatchMcpRepositoryUri', {
            value: this.cloudwatchMcpRepository.repositoryUri,
            description: 'CloudWatch MCP Runtime ECR Repository URI',
            exportName: `${this.stackName}-CloudWatchMcpRepositoryUri`,
        });
        new cdk.CfnOutput(this, 'CloudTrailMcpRepositoryUri', {
            value: this.cloudtrailMcpRepository.repositoryUri,
            description: 'CloudTrail MCP Runtime ECR Repository URI',
            exportName: `${this.stackName}-CloudTrailMcpRepositoryUri`,
        });
        new cdk.CfnOutput(this, 'InventoryMcpRepositoryUri', {
            value: this.inventoryMcpRepository.repositoryUri,
            description: 'Inventory MCP Runtime ECR Repository URI',
            exportName: `${this.stackName}-InventoryMcpRepositoryUri`,
        });
        new cdk.CfnOutput(this, 'SourceBucketName', {
            value: this.sourceBucket.bucketName,
            description: 'S3 bucket for CodeBuild source scripts',
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.sourceBucket, [
            { id: 'AwsSolutions-S1', reason: 'Server access logging not enabled for dev/demo.' },
        ]);
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            { id: 'AwsSolutions-L1', reason: 'Lambda runtime version managed by CDK.' },
            { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.' },
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions required for S3, ECR, CloudWatch, CodeBuild.' },
            { id: 'AwsSolutions-CB4', reason: 'KMS encryption not enabled for dev/demo.' },
        ]);
    }
    /**
     * Create a CodeBuild project that clones upstream MCP repo,
     * applies patch scripts, builds ARM64 Docker image,
     * and pushes to ECR.
     */
    createTransformBuildProject(id, repository, sourcePath, buildspecFile) {
        const codeBuildRole = new iam.Role(this, `${id}CodeBuildRole`, {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
            description: `IAM role for CodeBuild to build ${id} container image`,
            inlinePolicies: {
                CloudWatchLogsPolicy: new iam.PolicyDocument({
                    statements: [new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                            resources: [`arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/codebuild/*`],
                        })],
                }),
                ECRPushPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage',
                                'ecr:PutImage', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload',
                            ],
                            resources: [repository.repositoryArn],
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['ecr:GetAuthorizationToken'],
                            resources: ['*'],
                        }),
                    ],
                }),
                S3ReadPolicy: new iam.PolicyDocument({
                    statements: [new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['s3:GetObject', 's3:GetObjectVersion'],
                            resources: [this.sourceBucket.arnForObjects('*')],
                        })],
                }),
            },
        });
        const project = new codebuild.Project(this, `${id}BuildProject`, {
            projectName: `cloudops-${id.toLowerCase()}-build`,
            description: `Build ARM64 container for ${id} with streamable-http transport`,
            source: codebuild.Source.s3({
                bucket: this.sourceBucket,
                path: sourcePath,
            }),
            buildSpec: codebuild.BuildSpec.fromSourceFilename(buildspecFile),
            environment: {
                buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
                computeType: codebuild.ComputeType.SMALL,
                privileged: true,
                environmentVariables: {
                    AWS_DEFAULT_REGION: { value: cdk.Aws.REGION },
                    AWS_ACCOUNT_ID: { value: cdk.Aws.ACCOUNT_ID },
                    ECR_REPO_URI: { value: repository.repositoryUri },
                },
            },
            role: codeBuildRole,
            timeout: cdk.Duration.minutes(30),
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(codeBuildRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ecr:GetAuthorizationToken, S3, CloudWatch Logs.' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(project, [
            { id: 'AwsSolutions-CB4', reason: 'KMS encryption not enabled for dev/demo.' },
        ]);
        return project;
    }
    /**
     * Build the main agent runtime image using standard Docker build
     * (no patching needed - it's our own code).
     */
    buildMainRuntimeImage(sourceDeployment) {
        const buildProject = new codebuild.Project(this, 'MainRuntimeBuildProject', {
            projectName: 'cloudops-mainruntime-build',
            source: codebuild.Source.s3({
                bucket: this.sourceBucket,
                path: 'agentcore/',
            }),
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
                privileged: true,
                computeType: codebuild.ComputeType.SMALL,
            },
            environmentVariables: {
                AWS_DEFAULT_REGION: { value: this.region },
                AWS_ACCOUNT_ID: { value: this.account },
                IMAGE_REPO_NAME: { value: this.repository.repositoryName },
                IMAGE_TAG: { value: 'latest' },
            },
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {
                        commands: [
                            'echo Logging in to Amazon ECR...',
                            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
                        ],
                    },
                    build: {
                        commands: [
                            'echo Building the Docker image...',
                            'docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
                            'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
                        ],
                    },
                    post_build: {
                        commands: [
                            'echo Pushing the Docker image...',
                            'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
                        ],
                    },
                },
            }),
        });
        this.repository.grantPullPush(buildProject);
        this.sourceBucket.grantRead(buildProject);
        buildProject.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ecr:GetAuthorizationToken'],
            resources: ['*'],
        }));
        const triggerFn = new cdk.aws_lambda.Function(this, 'MainRuntimeBuildTriggerFn', {
            runtime: cdk.aws_lambda.Runtime.PYTHON_3_14,
            handler: 'index.handler',
            code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-trigger')),
            timeout: cdk.Duration.minutes(1),
        });
        triggerFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:StartBuild'],
            resources: [buildProject.projectArn],
        }));
        triggerFn.node.addDependency(sourceDeployment);
        new cdk.CustomResource(this, 'MainRuntimeTriggerBuild', {
            serviceToken: triggerFn.functionArn,
            properties: {
                ProjectName: buildProject.projectName,
                Timestamp: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
            },
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(buildProject, [
            { id: 'AwsSolutions-CB4', reason: 'KMS encryption not enabled for dev/demo.' },
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ECR, S3, CloudWatch.' },
        ], true);
    }
}
exports.ImageStack = ImageStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2Utc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbWFnZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMseURBQTJDO0FBQzNDLHFFQUF1RDtBQUN2RCx5REFBMkM7QUFDM0MsdURBQXlDO0FBQ3pDLHdFQUEwRDtBQUMxRCwrREFBaUQ7QUFFakQsMkNBQTZCO0FBQzdCLHFDQUEwQztBQUUxQzs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFhLFVBQVcsU0FBUSxHQUFHLENBQUMsS0FBSztJQVN2QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDhDQUE4QztRQUM5QyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDOUQsY0FBYyxFQUFFLHdCQUF3QjtZQUN4QyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLGFBQWEsRUFBRSxJQUFJO1lBQ25CLGVBQWUsRUFBRSxJQUFJO1lBQ3JCLGNBQWMsRUFBRSxDQUFDLEVBQUUsV0FBVyxFQUFFLHFCQUFxQixFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsQ0FBQztTQUM1RSxDQUFDLENBQUM7UUFFSCxnREFBZ0Q7UUFDaEQsSUFBSSxDQUFDLG9CQUFvQixHQUFHLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDM0UsY0FBYyxFQUFFLDhCQUE4QjtZQUM5QyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLGFBQWEsRUFBRSxJQUFJO1lBQ25CLGVBQWUsRUFBRSxJQUFJO1lBQ3JCLGNBQWMsRUFBRSxDQUFDLEVB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QyxVQUFVLENBQUM7U0FDckMsQ0FBQyxDQUFDLENBQUM7UUFDSixTQUFTLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBRS9DLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDdEQsWUFBWSxFQUFFLFNBQVMsQ0FBQyxXQUFXO1lBQ25DLFVBQVUsRUFBRTtnQkFDVixXQUFXLEVBQUUsWUFBWSxDQUFDLFdBQVc7Z0JBQ3JDLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBRTthQUN0RTtTQUNGLENBQUMsQ0FBQztRQUVILHlCQUFlLENBQUMsdUJBQXVCLENBQUMsWUFBWSxFQUFFO1lBQ3BELEVBQUUsRUFBRSxFQUFFLGtCQUFrQixFQUFFLE1BQU0sRUFBRSwwQ0FBMEMsRUFBRTtZQUM5RSxFQUFFLEVBQUUsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLEVBQUUsbUNBQW1DLEVBQUU7U0FDekUsRUFBRSxJQUFJLENBQUMsQ0FBQztJQUNYLENBQUM7Q0FDRjtBQTdvQkQsZ0NBNm9CQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5cbi8qKlxuICogSW1hZ2VTdGFjazogQnVpbGRzIERvY2tlciBpbWFnZXMgZm9yIE1DUCBzZXJ2ZXIgcnVudGltZXMgdXNpbmcgdGhlXG4gKiBzdGRpby10by1IVFRQIHBhdGNoaW5nIHBhdHRlcm4uXG4gKlxuICogRm9yIGVhY2ggTUNQIHNlcnZlciAoYmlsbGluZywgcHJpY2luZyk6XG4gKiAgIDEuIENvZGVCdWlsZCBjbG9uZXMgdGhlIHVwc3RyZWFtIEFXUyBMYWJzIE1DUCByZXBvXG4gKiAgIDIuIHBhdGNoLXtzZXJ2ZXJ9LnNoIHBhdGNoZXMgc2VydmVyLnB5IGZvciBzdHJlYW1hYmxlLWh0dHAgdHJhbnNwb3J0XG4gKiAgIDMuIEFkZHMgdXZpY29ybiArIHN0YXJsZXR0ZSBkZXBlbmRlbmNpZXNcbiAqICAgNC4gUGF0Y2hlcyBEb2NrZXJmaWxlIChFWFBPU0UgODAwMCwgZW50cnlwb2ludCwgaGVhbHRoY2hlY2spXG4gKiAgIDUuIEJ1aWxkcyBBUk02NCBEb2NrZXIgaW1hZ2UgYW5kIHB1c2hlcyB0byBFQ1JcbiAqXG4gKiBCYXNlZCBvbjogaHR0cHM6Ly9naXRodWIuY29tL2F3cy1zYW1wbGVzL3NhbXBsZS1hd3Mtc3RkaW8taHR0cC1wcm94eS1tY3BcbiAqL1xuZXhwb3J0IGNsYXNzIEltYWdlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgcmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHB1YmxpYyByZWFkb25seSBiaWxsaW5nTWNwUmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHB1YmxpYyByZWFkb25seSBwcmljaW5nTWNwUmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHB1YmxpYyByZWFkb25seSBjbG91ZHdhdGNoTWNwUmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHB1YmxpYyByZWFkb25seSBjbG91ZHRyYWlsTWNwUmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHB1YmxpYyByZWFkb25seSBpbnZlbnRvcnlNY3BSZXBvc2l0b3J5OiBlY3IuUmVwb3NpdG9yeTtcbiAgcHVibGljIHJlYWRvbmx5IHNvdXJjZUJ1Y2tldDogczMuQnVja2V0O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIEVDUiBSZXBvc2l0b3J5IGZvciBNYWluIEFnZW50IFJ1bnRpbWUgaW1hZ2VcbiAgICB0aGlzLnJlcG9zaXRvcnkgPSBuZXcgZWNyLlJlcG9zaXRvcnkodGhpcywgJ1J1bnRpbWVSZXBvc2l0b3J5Jywge1xuICAgICAgcmVwb3NpdG9yeU5hbWU6ICdjbG91ZG9wcy1hZ2VudC1ydW50aW1lJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBlbXB0eU9uRGVsZXRlOiB0cnVlLFxuICAgICAgaW1hZ2VTY2FuT25QdXNoOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7IGRlc2NyaXB0aW9uOiAnS2VlcCBsYXN0IDEwIGltYWdlcycsIG1heEltYWdlQ291bnQ6IDEwIH1dLFxuICAgIH0pO1xuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnkgZm9yIEJpbGxpbmcgTUNQIFNlcnZlciBSdW50aW1lXG4gICAgdGhpcy5iaWxsaW5nTWNwUmVwb3NpdG9yeSA9IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnQmlsbGluZ01jcFJlcG9zaXRvcnknLCB7XG4gICAgICByZXBvc2l0b3J5TmFtZTogJ2Nsb3Vkb3BzLWJpbGxpbmctbWNwLXJ1bnRpbWUnLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGVtcHR5T25EZWxldGU6IHRydWUsXG4gICAgICBpbWFnZVNjYW5PblB1c2g6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3sgZGVzY3JpcHRpb246ICdLZWVwIGxhc3QgMTAgaW1hZ2VzJywgbWF4SW1hZ2VDb3VudDogMTAgfV0sXG4gICAgfSk7XG5cbiAgICAvLyBFQ1IgUmVwb3NpdG9yeSBmb3IgUHJpY2luZyBNQ1AgU2VydmVyIFJ1bnRpbWVcbiAgICB0aGlzLnByaWNpbmdNY3BSZXBvc2l0b3J5ID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdQcmljaW5nTWNwUmVwb3NpdG9yeScsIHtcbiAgICAgIHJlcG9zaXRvcnlOYW1lOiAnY2xvdWRvcHMtcHJpY2luZy1tY3AtcnVudGltZScsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZW1wdHlPbkRlbGV0ZTogdHJ1ZSxcbiAgICAgIGltYWdlU2Nhbk9uUHVzaDogdHJ1ZSxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbeyBkZXNjcmlwdGlvbjogJ0tlZXAgbGFzdCAxMCBpbWFnZXMnLCBtYXhJbWFnZUNvdW50OiAxMCB9XSxcbiAgICB9KTtcblxuICAgIC8vIEVDUiBSZXBvc2l0b3J5IGZvciBDbG91ZFdhdGNoIE1DUCBTZXJ2ZXIgUnVudGltZVxuICAgIHRoaXMuY2xvdWR3YXRjaE1jcFJlcG9zaXRvcnkgPSBuZXcgZWNyLlJlcG9zaXRvcnkodGhpcywgJ0Nsb3VkV2F0Y2hNY3BSZXBvc2l0b3J5Jywge1xuICAgICAgcmVwb3NpdG9yeU5hbWU6ICdjbG91ZG9wcy1jbG91ZHdhdGNoLW1jcC1ydW50aW1lJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBlbXB0eU9uRGVsZXRlOiB0cnVlLFxuICAgICAgaW1hZ2VTY2FuT25QdXNoOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7IGRlc2NyaXB0aW9uOiAnS2VlcCBsYXN0IDEwIGltYWdlcycsIG1heEltYWdlQ291bnQ6IDEwIH1dLFxuICAgIH0pO1xuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnkgZm9yIENsb3VkVHJhaWwgTUNQIFNlcnZlciBSdW50aW1lXG4gICAgdGhpcy5jbG91ZHRyYWlsTWNwUmVwb3NpdG9yeSA9IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnQ2xvdWRUcmFpbE1jcFJlcG9zaXRvcnknLCB7XG4gICAgICByZXBvc2l0b3J5TmFtZTogJ2Nsb3Vkb3BzLWNsb3VkdHJhaWwtbWNwLXJ1bnRpbWUnLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGVtcHR5T25EZWxldGU6IHRydWUsXG4gICAgICBpbWFnZVNjYW5PblB1c2g6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3sgZGVzY3JpcHRpb246ICdLZWVwIGxhc3QgMTAgaW1hZ2VzJywgbWF4SW1hZ2VDb3VudDogMTAgfV0sXG4gICAgfSk7XG5cbiAgICAvLyBFQ1IgUmVwb3NpdG9yeSBmb3IgSW52ZW50b3J5IE1DUCBTZXJ2ZXIgUnVudGltZVxuICAgIHRoaXMuaW52ZW50b3J5TWNwUmVwb3NpdG9yeSA9IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnSW52ZW50b3J5TWNwUmVwb3NpdG9yeScsIHtcbiAgICAgIHJlcG9zaXRvcnlOYW1lOiAnY2xvdWRvcHMtaW52ZW50b3J5LW1jcC1ydW50aW1lJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBlbXB0eU9uRGVsZXRlOiB0cnVlLFxuICAgICAgaW1hZ2VTY2FuT25QdXNoOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7IGRlc2NyaXB0aW9uOiAnS2VlcCBsYXN0IDEwIGltYWdlcycsIG1heEltYWdlQ291bnQ6IDEwIH1dLFxuICAgIH0pO1xuXG4gICAgLy8gUzMgQnVja2V0IGZvciBDb2RlQnVpbGQgc291cmNlIChidWlsZHNwZWMgKyBwYXRjaCBzY3JpcHRzKVxuICAgIHRoaXMuc291cmNlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnU291cmNlQnVja2V0Jywge1xuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7IGlkOiAnRGVsZXRlT2xkVmVyc2lvbnMnLCBlbmFibGVkOiB0cnVlLCBub25jdXJyZW50VmVyc2lvbkV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDMwKSB9LFxuICAgICAgXSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFVwbG9hZCBjb2RlYnVpbGQtc2NyaXB0cyB0byBTM1xuICAgIGNvbnN0IHNjcmlwdHNEZXBsb3ltZW50ID0gbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0NvZGVCdWlsZFNjcmlwdHNEZXBsb3ltZW50Jywge1xuICAgICAgc291cmNlczogW3MzZGVwbG95LlNvdXJjZS5hc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vY29kZWJ1aWxkLXNjcmlwdHMnKSldLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHRoaXMuc291cmNlQnVja2V0LFxuICAgICAgZGVzdGluYXRpb25LZXlQcmVmaXg6ICdjb2RlYnVpbGQtc2NyaXB0cy8nLFxuICAgICAgZXh0cmFjdDogdHJ1ZSxcbiAgICAgIHBydW5lOiBmYWxzZSxcbiAgICAgIHJldGFpbk9uRGVsZXRlOiBmYWxzZSxcbiAgICAgIG1lbW9yeUxpbWl0OiA1MTIsXG4gICAgfSk7XG5cbiAgICAvLyBBbHNvIHVwbG9hZCBhZ2VudGNvcmUgZGlyZWN0b3J5IGZvciBtYWluIHJ1bnRpbWUgYnVpbGRcbiAgICBjb25zdCBhZ2VudGNvcmVEZXBsb3ltZW50ID0gbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0FnZW50Y29yZVNvdXJjZURlcGxveW1lbnQnLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9hZ2VudGNvcmUnKSldLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHRoaXMuc291cmNlQnVja2V0LFxuICAgICAgZGVzdGluYXRpb25LZXlQcmVmaXg6ICdhZ2VudGNvcmUvJyxcbiAgICB9KTtcblxuICAgIC8vIFVwbG9hZCBpbnZlbnRvcnkgTUNQIHNlcnZlciBzb3VyY2UgdG8gUzNcbiAgICBjb25zdCBpbnZlbnRvcnlTb3VyY2VEZXBsb3ltZW50ID0gbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0ludmVudG9yeVNvdXJjZURlcGxveW1lbnQnLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9tY3Atc2VydmVycy9pbnZlbnRvcnknKSldLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHRoaXMuc291cmNlQnVja2V0LFxuICAgICAgZGVzdGluYXRpb25LZXlQcmVmaXg6ICdpbnZlbnRvcnkvJyxcbiAgICB9KTtcblxuICAgIC8vIC0tLSBCdWlsZCBUcmlnZ2VyIExhbWJkYSAtLS1cbiAgICBjb25zdCBidWlsZFRyaWdnZXJGbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0J1aWxkVHJpZ2dlckZ1bmN0aW9uJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTQsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2xhbWJkYS9idWlsZC10cmlnZ2VyJykpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICBtZW1vcnlTaXplOiAxMjgsXG4gICAgICBkZXNjcmlwdGlvbjogJ1RyaWdnZXJzIENvZGVCdWlsZCBidWlsZCBmb3IgTUNQIHNlcnZlciBjb250YWluZXInLFxuICAgIH0pO1xuXG4gICAgLy8gLS0tIEJ1aWxkIFdhaXRlciBMYW1iZGEgLS0tXG4gICAgY29uc3QgYnVpbGRXYWl0ZXJGbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0J1aWxkV2FpdGVyRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xNCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vbGFtYmRhL2J1aWxkLXdhaXRlcicpKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUG9sbHMgQ29kZUJ1aWxkIGJ1aWxkIHN0YXR1cyB1bnRpbCBjb21wbGV0aW9uJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBCaWxsaW5nIE1DUCBTZXJ2ZXIgLSBDb2RlQnVpbGQgKyBUcmFuc2Zvcm1cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgYmlsbGluZ0J1aWxkUHJvamVjdCA9IHRoaXMuY3JlYXRlVHJhbnNmb3JtQnVpbGRQcm9qZWN0KFxuICAgICAgJ0JpbGxpbmdNY3AnLFxuICAgICAgdGhpcy5iaWxsaW5nTWNwUmVwb3NpdG9yeSxcbiAgICAgICdjb2RlYnVpbGQtc2NyaXB0cy8nLFxuICAgICAgJ2J1aWxkc3BlYy1iaWxsaW5nLnltbCcsXG4gICAgKTtcbiAgICBiaWxsaW5nQnVpbGRQcm9qZWN0Lm5vZGUuYWRkRGVwZW5kZW5jeShzY3JpcHRzRGVwbG95bWVudCk7XG5cbiAgICAvLyBHcmFudCBMYW1iZGEgcGVybWlzc2lvbnNcbiAgICBidWlsZFRyaWdnZXJGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydjb2RlYnVpbGQ6U3RhcnRCdWlsZCddLFxuICAgICAgcmVzb3VyY2VzOiBbYmlsbGluZ0J1aWxkUHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICB9KSk7XG4gICAgYnVpbGRXYWl0ZXJGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydjb2RlYnVpbGQ6QmF0Y2hHZXRCdWlsZHMnXSxcbiAgICAgIHJlc291cmNlczogW2JpbGxpbmdCdWlsZFByb2plY3QucHJvamVjdEFybl0sXG4gICAgfSkpO1xuXG4gICAgLy8gVHJpZ2dlciBiaWxsaW5nIGJ1aWxkXG4gICAgY29uc3QgYmlsbGluZ0J1aWxkVHJpZ2dlciA9IG5ldyBjZGsuQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0JpbGxpbmdCdWlsZFRyaWdnZXInLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGJ1aWxkVHJpZ2dlckZuLmZ1bmN0aW9uQXJuLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBQcm9qZWN0TmFtZTogYmlsbGluZ0J1aWxkUHJvamVjdC5wcm9qZWN0TmFtZSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGJpbGxpbmdCdWlsZFRyaWdnZXIubm9kZS5hZGREZXBlbmRlbmN5KHNjcmlwdHNEZXBsb3ltZW50KTtcblxuICAgIC8vIFdhaXQgZm9yIGJpbGxpbmcgYnVpbGRcbiAgICBjb25zdCBiaWxsaW5nQnVpbGRXYWl0ZXIgPSBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdCaWxsaW5nQnVpbGRXYWl0ZXInLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGJ1aWxkV2FpdGVyRm4uZnVuY3Rpb25Bcm4sXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIEJ1aWxkSWQ6IGJpbGxpbmdCdWlsZFRyaWdnZXIuZ2V0QXR0U3RyaW5nKCdCdWlsZElkJyksXG4gICAgICAgIE1heFdhaXRTZWNvbmRzOiAnMTIwMCcsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGJpbGxpbmdCdWlsZFdhaXRlci5ub2RlLmFkZERlcGVuZGVuY3koYmlsbGluZ0J1aWxkVHJpZ2dlcik7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUHJpY2luZyBNQ1AgU2VydmVyIC0gQ29kZUJ1aWxkICsgVHJhbnNmb3JtXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHByaWNpbmdCdWlsZFByb2plY3QgPSB0aGlzLmNyZWF0ZVRyYW5zZm9ybUJ1aWxkUHJvamVjdChcbiAgICAgICdQcmljaW5nTWNwJyxcbiAgICAgIHRoaXMucHJpY2luZ01jcFJlcG9zaXRvcnksXG4gICAgICAnY29kZWJ1aWxkLXNjcmlwdHMvJyxcbiAgICAgICdidWlsZHNwZWMtcHJpY2luZy55bWwnLFxuICAgICk7XG4gICAgcHJpY2luZ0J1aWxkUHJvamVjdC5ub2RlLmFkZERlcGVuZGVuY3koc2NyaXB0c0RlcGxveW1lbnQpO1xuXG4gICAgLy8gR3JhbnQgTGFtYmRhIHBlcm1pc3Npb25zIGZvciBwcmljaW5nXG4gICAgYnVpbGRUcmlnZ2VyRm4uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOlN0YXJ0QnVpbGQnXSxcbiAgICAgIHJlc291cmNlczogW3ByaWNpbmdCdWlsZFByb2plY3QucHJvamVjdEFybl0sXG4gICAgfSkpO1xuICAgIGJ1aWxkV2FpdGVyRm4uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOkJhdGNoR2V0QnVpbGRzJ10sXG4gICAgICByZXNvdXJjZXM6IFtwcmljaW5nQnVpbGRQcm9qZWN0LnByb2plY3RBcm5dLFxuICAgIH0pKTtcblxuICAgIC8vIFRyaWdnZXIgcHJpY2luZyBidWlsZFxuICAgIGNvbnN0IHByaWNpbmdCdWlsZFRyaWdnZXIgPSBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdQcmljaW5nQnVpbGRUcmlnZ2VyJywge1xuICAgICAgc2VydmljZVRva2VuOiBidWlsZFRyaWdnZXJGbi5mdW5jdGlvbkFybixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgUHJvamVjdE5hbWU6IHByaWNpbmdCdWlsZFByb2plY3QucHJvamVjdE5hbWUsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBwcmljaW5nQnVpbGRUcmlnZ2VyLm5vZGUuYWRkRGVwZW5kZW5jeShzY3JpcHRzRGVwbG95bWVudCk7XG5cbiAgICAvLyBXYWl0IGZvciBwcmljaW5nIGJ1aWxkXG4gICAgY29uc3QgcHJpY2luZ0J1aWxkV2FpdGVyID0gbmV3IGNkay5DdXN0b21SZXNvdXJjZSh0aGlzLCAnUHJpY2luZ0J1aWxkV2FpdGVyJywge1xuICAgICAgc2VydmljZVRva2VuOiBidWlsZFdhaXRlckZuLmZ1bmN0aW9uQXJuLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBCdWlsZElkOiBwcmljaW5nQnVpbGRUcmlnZ2VyLmdldEF0dFN0cmluZygnQnVpbGRJZCcpLFxuICAgICAgICBNYXhXYWl0U2Vjb25kczogJzEyMDAnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBwcmljaW5nQnVpbGRXYWl0ZXIubm9kZS5hZGREZXBlbmRlbmN5KHByaWNpbmdCdWlsZFRyaWdnZXIpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkV2F0Y2ggTUNQIFNlcnZlciAtIENvZGVCdWlsZCArIFRyYW5zZm9ybVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBjbG91ZHdhdGNoQnVpbGRQcm9qZWN0ID0gdGhpcy5jcmVhdGVUcmFuc2Zvcm1CdWlsZFByb2plY3QoXG4gICAgICAnQ2xvdWRXYXRjaE1jcCcsXG4gICAgICB0aGlzLmNsb3Vkd2F0Y2hNY3BSZXBvc2l0b3J5LFxuICAgICAgJ2NvZGVidWlsZC1zY3JpcHRzLycsXG4gICAgICAnYnVpbGRzcGVjLWNsb3Vkd2F0Y2gueW1sJyxcbiAgICApO1xuICAgIGNsb3Vkd2F0Y2hCdWlsZFByb2plY3Qubm9kZS5hZGREZXBlbmRlbmN5KHNjcmlwdHNEZXBsb3ltZW50KTtcblxuICAgIC8vIEdyYW50IExhbWJkYSBwZXJtaXNzaW9ucyBmb3IgQ2xvdWRXYXRjaFxuICAgIGJ1aWxkVHJpZ2dlckZuLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2NvZGVidWlsZDpTdGFydEJ1aWxkJ10sXG4gICAgICByZXNvdXJjZXM6IFtjbG91ZHdhdGNoQnVpbGRQcm9qZWN0LnByb2plY3RBcm5dLFxuICAgIH0pKTtcbiAgICBidWlsZFdhaXRlckZuLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2NvZGVidWlsZDpCYXRjaEdldEJ1aWxkcyddLFxuICAgICAgcmVzb3VyY2VzOiBbY2xvdWR3YXRjaEJ1aWxkUHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICB9KSk7XG5cbiAgICAvLyBUcmlnZ2VyIENsb3VkV2F0Y2ggYnVpbGRcbiAgICBjb25zdCBjbG91ZHdhdGNoQnVpbGRUcmlnZ2VyID0gbmV3IGNkay5DdXN0b21SZXNvdXJjZSh0aGlzLCAnQ2xvdWRXYXRjaEJ1aWxkVHJpZ2dlcicsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogYnVpbGRUcmlnZ2VyRm4uZnVuY3Rpb25Bcm4sXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIFByb2plY3ROYW1lOiBjbG91ZHdhdGNoQnVpbGRQcm9qZWN0LnByb2plY3ROYW1lLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgY2xvdWR3YXRjaEJ1aWxkVHJpZ2dlci5ub2RlLmFkZERlcGVuZGVuY3koc2NyaXB0c0RlcGxveW1lbnQpO1xuXG4gICAgLy8gV2FpdCBmb3IgQ2xvdWRXYXRjaCBidWlsZFxuICAgIGNvbnN0IGNsb3Vkd2F0Y2hCdWlsZFdhaXRlciA9IG5ldyBjZGsuQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0Nsb3VkV2F0Y2hCdWlsZFdhaXRlcicsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogYnVpbGRXYWl0ZXJGbi5mdW5jdGlvbkFybixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgQnVpbGRJZDogY2xvdWR3YXRjaEJ1aWxkVHJpZ2dlci5nZXRBdHRTdHJpbmcoJ0J1aWxkSWQnKSxcbiAgICAgICAgTWF4V2FpdFNlY29uZHM6ICcxMjAwJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgY2xvdWR3YXRjaEJ1aWxkV2FpdGVyLm5vZGUuYWRkRGVwZW5kZW5jeShjbG91ZHdhdGNoQnVpbGRUcmlnZ2VyKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDbG91ZFRyYWlsIE1DUCBTZXJ2ZXIgLSBDb2RlQnVpbGQgKyBUcmFuc2Zvcm1cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgY2xvdWR0cmFpbEJ1aWxkUHJvamVjdCA9IHRoaXMuY3JlYXRlVHJhbnNmb3JtQnVpbGRQcm9qZWN0KFxuICAgICAgJ0Nsb3VkVHJhaWxNY3AnLFxuICAgICAgdGhpcy5jbG91ZHRyYWlsTWNwUmVwb3NpdG9yeSxcbiAgICAgICdjb2RlYnVpbGQtc2NyaXB0cy8nLFxuICAgICAgJ2J1aWxkc3BlYy1jbG91ZHRyYWlsLnltbCcsXG4gICAgKTtcbiAgICBjbG91ZHRyYWlsQnVpbGRQcm9qZWN0Lm5vZGUuYWRkRGVwZW5kZW5jeShzY3JpcHRzRGVwbG95bWVudCk7XG5cbiAgICAvLyBHcmFudCBMYW1iZGEgcGVybWlzc2lvbnMgZm9yIENsb3VkVHJhaWxcbiAgICBidWlsZFRyaWdnZXJGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydjb2RlYnVpbGQ6U3RhcnRCdWlsZCddLFxuICAgICAgcmVzb3VyY2VzOiBbY2xvdWR0cmFpbEJ1aWxkUHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICB9KSk7XG4gICAgYnVpbGRXYWl0ZXJGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydjb2RlYnVpbGQ6QmF0Y2hHZXRCdWlsZHMnXSxcbiAgICAgIHJlc291cmNlczogW2Nsb3VkdHJhaWxCdWlsZFByb2plY3QucHJvamVjdEFybl0sXG4gICAgfSkpO1xuXG4gICAgLy8gVHJpZ2dlciBDbG91ZFRyYWlsIGJ1aWxkXG4gICAgY29uc3QgY2xvdWR0cmFpbEJ1aWxkVHJpZ2dlciA9IG5ldyBjZGsuQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0Nsb3VkVHJhaWxCdWlsZFRyaWdnZXInLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGJ1aWxkVHJpZ2dlckZuLmZ1bmN0aW9uQXJuLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBQcm9qZWN0TmFtZTogY2xvdWR0cmFpbEJ1aWxkUHJvamVjdC5wcm9qZWN0TmFtZSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGNsb3VkdHJhaWxCdWlsZFRyaWdnZXIubm9kZS5hZGREZXBlbmRlbmN5KHNjcmlwdHNEZXBsb3ltZW50KTtcblxuICAgIC8vIFdhaXQgZm9yIENsb3VkVHJhaWwgYnVpbGRcbiAgICBjb25zdCBjbG91ZHRyYWlsQnVpbGRXYWl0ZXIgPSBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdDbG91ZFRyYWlsQnVpbGRXYWl0ZXInLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGJ1aWxkV2FpdGVyRm4uZnVuY3Rpb25Bcm4sXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIEJ1aWxkSWQ6IGNsb3VkdHJhaWxCdWlsZFRyaWdnZXIuZ2V0QXR0U3RyaW5nKCdCdWlsZElkJyksXG4gICAgICAgIE1heFdhaXRTZWNvbmRzOiAnMTIwMCcsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGNsb3VkdHJhaWxCdWlsZFdhaXRlci5ub2RlLmFkZERlcGVuZGVuY3koY2xvdWR0cmFpbEJ1aWxkVHJpZ2dlcik7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gSW52ZW50b3J5IE1DUCBTZXJ2ZXIgLSBEaXJlY3QgRG9ja2VyIEJ1aWxkXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGludmVudG9yeUJ1aWxkUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnSW52ZW50b3J5TWNwQ29kZUJ1aWxkUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdjb2RlYnVpbGQuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgQ29kZUJ1aWxkIHRvIGJ1aWxkIEludmVudG9yeSBNQ1AgY29udGFpbmVyIGltYWdlJyxcbiAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgIENsb3VkV2F0Y2hMb2dzUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBbbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogWydsb2dzOkNyZWF0ZUxvZ0dyb3VwJywgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJywgJ2xvZ3M6UHV0TG9nRXZlbnRzJ10sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7Y2RrLkF3cy5SRUdJT059OiR7Y2RrLkF3cy5BQ0NPVU5UX0lEfTpsb2ctZ3JvdXA6L2F3cy9jb2RlYnVpbGQvKmBdLFxuICAgICAgICAgIH0pXSxcbiAgICAgICAgfSksXG4gICAgICAgIEVDUlB1c2hQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2VjcjpCYXRjaENoZWNrTGF5ZXJBdmFpbGFiaWxpdHknLCAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLCAnZWNyOkJhdGNoR2V0SW1hZ2UnLFxuICAgICAgICAgICAgICAgICdlY3I6UHV0SW1hZ2UnLCAnZWNyOkluaXRpYXRlTGF5ZXJVcGxvYWQnLCAnZWNyOlVwbG9hZExheWVyUGFydCcsICdlY3I6Q29tcGxldGVMYXllclVwbG9hZCcsXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuaW52ZW50b3J5TWNwUmVwb3NpdG9yeS5yZXBvc2l0b3J5QXJuXSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbiddLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSxcbiAgICAgICAgfSksXG4gICAgICAgIFMzUmVhZFBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0JywgJ3MzOkdldE9iamVjdFZlcnNpb24nXSxcbiAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuc291cmNlQnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXG4gICAgICAgICAgfSldLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBpbnZlbnRvcnlCdWlsZFByb2plY3QgPSBuZXcgY29kZWJ1aWxkLlByb2plY3QodGhpcywgJ0ludmVudG9yeU1jcEJ1aWxkUHJvamVjdCcsIHtcbiAgICAgIHByb2plY3ROYW1lOiAnY2xvdWRvcHMtaW52ZW50b3J5bWNwLWJ1aWxkJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgQVJNNjQgY29udGFpbmVyIGZvciBJbnZlbnRvcnkgTUNQIHNlcnZlcicsXG4gICAgICBzb3VyY2U6IGNvZGVidWlsZC5Tb3VyY2UuczMoe1xuICAgICAgICBidWNrZXQ6IHRoaXMuc291cmNlQnVja2V0LFxuICAgICAgICBwYXRoOiAnaW52ZW50b3J5LycsXG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5MaW51eEFybUJ1aWxkSW1hZ2UuQU1BWk9OX0xJTlVYXzJfU1RBTkRBUkRfM18wLFxuICAgICAgICBjb21wdXRlVHlwZTogY29kZWJ1aWxkLkNvbXB1dGVUeXBlLlNNQUxMLFxuICAgICAgICBwcml2aWxlZ2VkOiB0cnVlLFxuICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgIEFXU19ERUZBVUxUX1JFR0lPTjogeyB2YWx1ZTogY2RrLkF3cy5SRUdJT04gfSxcbiAgICAgICAgICBBV1NfQUNDT1VOVF9JRDogeyB2YWx1ZTogY2RrLkF3cy5BQ0NPVU5UX0lEIH0sXG4gICAgICAgICAgRUNSX1JFUE9fVVJJOiB7IHZhbHVlOiB0aGlzLmludmVudG9yeU1jcFJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogJzAuMicsXG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIHByZV9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gXCI9PT0gUGhhc2UgUHJlLWJ1aWxkIC0gRUNSIExvZ2luID09PVwiJyxcbiAgICAgICAgICAgICAgJ2F3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uICRBV1NfREVGQVVMVF9SRUdJT04gfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAkQVdTX0FDQ09VTlRfSUQuZGtyLmVjci4kQVdTX0RFRkFVTFRfUkVHSU9OLmFtYXpvbmF3cy5jb20nLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBcIj09PSBQaGFzZSBCdWlsZCAtIERvY2tlciBpbWFnZSA9PT1cIicsXG4gICAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLXQgJEVDUl9SRVBPX1VSSTokQ09ERUJVSUxEX0JVSUxEX05VTUJFUiAuJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciB0YWcgJEVDUl9SRVBPX1VSSTokQ09ERUJVSUxEX0JVSUxEX05VTUJFUiAkRUNSX1JFUE9fVVJJOmxhdGVzdCcsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcG9zdF9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gXCI9PT0gUGhhc2UgUG9zdC1idWlsZCAtIFB1c2ggdG8gRUNSID09PVwiJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBwdXNoICRFQ1JfUkVQT19VUkk6JENPREVCVUlMRF9CVUlMRF9OVU1CRVInLFxuICAgICAgICAgICAgICAnZG9ja2VyIHB1c2ggJEVDUl9SRVBPX1VSSTpsYXRlc3QnLFxuICAgICAgICAgICAgICAnZWNobyBcIkludmVudG9yeSBNQ1AgaW1hZ2UgcHVzaGVkIHN1Y2Nlc3NmdWxseS5cIicsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIHJvbGU6IGludmVudG9yeUJ1aWxkUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSxcbiAgICB9KTtcbiAgICBpbnZlbnRvcnlCdWlsZFByb2plY3Qubm9kZS5hZGREZXBlbmRlbmN5KGludmVudG9yeVNvdXJjZURlcGxveW1lbnQpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGludmVudG9yeUJ1aWxkUm9sZSwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnV2lsZGNhcmQgZm9yIGVjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4sIFMzLCBDbG91ZFdhdGNoIExvZ3MuJyB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGludmVudG9yeUJ1aWxkUHJvamVjdCwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1DQjQnLCByZWFzb246ICdLTVMgZW5jcnlwdGlvbiBub3QgZW5hYmxlZCBmb3IgZGV2L2RlbW8uJyB9LFxuICAgIF0pO1xuXG4gICAgLy8gR3JhbnQgTGFtYmRhIHBlcm1pc3Npb25zIGZvciBJbnZlbnRvcnlcbiAgICBidWlsZFRyaWdnZXJGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydjb2RlYnVpbGQ6U3RhcnRCdWlsZCddLFxuICAgICAgcmVzb3VyY2VzOiBbaW52ZW50b3J5QnVpbGRQcm9qZWN0LnByb2plY3RBcm5dLFxuICAgIH0pKTtcbiAgICBidWlsZFdhaXRlckZuLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2NvZGVidWlsZDpCYXRjaEdldEJ1aWxkcyddLFxuICAgICAgcmVzb3VyY2VzOiBbaW52ZW50b3J5QnVpbGRQcm9qZWN0LnByb2plY3RBcm5dLFxuICAgIH0pKTtcblxuICAgIC8vIFRyaWdnZXIgSW52ZW50b3J5IGJ1aWxkXG4gICAgY29uc3QgaW52ZW50b3J5QnVpbGRUcmlnZ2VyID0gbmV3IGNkay5DdXN0b21SZXNvdXJjZSh0aGlzLCAnSW52ZW50b3J5QnVpbGRUcmlnZ2VyJywge1xuICAgICAgc2VydmljZVRva2VuOiBidWlsZFRyaWdnZXJGbi5mdW5jdGlvbkFybixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgUHJvamVjdE5hbWU6IGludmVudG9yeUJ1aWxkUHJvamVjdC5wcm9qZWN0TmFtZSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGludmVudG9yeUJ1aWxkVHJpZ2dlci5ub2RlLmFkZERlcGVuZGVuY3koaW52ZW50b3J5U291cmNlRGVwbG95bWVudCk7XG5cbiAgICAvLyBXYWl0IGZvciBJbnZlbnRvcnkgYnVpbGRcbiAgICBjb25zdCBpbnZlbnRvcnlCdWlsZFdhaXRlciA9IG5ldyBjZGsuQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0ludmVudG9yeUJ1aWxkV2FpdGVyJywge1xuICAgICAgc2VydmljZVRva2VuOiBidWlsZFdhaXRlckZuLmZ1bmN0aW9uQXJuLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBCdWlsZElkOiBpbnZlbnRvcnlCdWlsZFRyaWdnZXIuZ2V0QXR0U3RyaW5nKCdCdWlsZElkJyksXG4gICAgICAgIE1heFdhaXRTZWNvbmRzOiAnMTIwMCcsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGludmVudG9yeUJ1aWxkV2FpdGVyLm5vZGUuYWRkRGVwZW5kZW5jeShpbnZlbnRvcnlCdWlsZFRyaWdnZXIpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE1haW4gQWdlbnQgUnVudGltZSAtIFN0YW5kYXJkIERvY2tlciBCdWlsZFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLmJ1aWxkTWFpblJ1bnRpbWVJbWFnZShhZ2VudGNvcmVEZXBsb3ltZW50KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNYWluUmVwb3NpdG9yeVVyaScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTWFpbiBSdW50aW1lIEVDUiBSZXBvc2l0b3J5IFVSSScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tTWFpblJlcG9zaXRvcnlVcmlgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JpbGxpbmdNY3BSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IHRoaXMuYmlsbGluZ01jcFJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmlsbGluZyBNQ1AgUnVudGltZSBFQ1IgUmVwb3NpdG9yeSBVUkknLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUJpbGxpbmdNY3BSZXBvc2l0b3J5VXJpYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQcmljaW5nTWNwUmVwb3NpdG9yeVVyaScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnByaWNpbmdNY3BSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICBkZXNjcmlwdGlvbjogJ1ByaWNpbmcgTUNQIFJ1bnRpbWUgRUNSIFJlcG9zaXRvcnkgVVJJJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1QcmljaW5nTWNwUmVwb3NpdG9yeVVyaWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2xvdWRXYXRjaE1jcFJlcG9zaXRvcnlVcmknLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jbG91ZHdhdGNoTWNwUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIE1DUCBSdW50aW1lIEVDUiBSZXBvc2l0b3J5IFVSSScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQ2xvdWRXYXRjaE1jcFJlcG9zaXRvcnlVcmlgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkVHJhaWxNY3BSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IHRoaXMuY2xvdWR0cmFpbE1jcFJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRUcmFpbCBNQ1AgUnVudGltZSBFQ1IgUmVwb3NpdG9yeSBVUkknLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUNsb3VkVHJhaWxNY3BSZXBvc2l0b3J5VXJpYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbnZlbnRvcnlNY3BSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IHRoaXMuaW52ZW50b3J5TWNwUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgZGVzY3JpcHRpb246ICdJbnZlbnRvcnkgTUNQIFJ1bnRpbWUgRUNSIFJlcG9zaXRvcnkgVVJJJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1JbnZlbnRvcnlNY3BSZXBvc2l0b3J5VXJpYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTb3VyY2VCdWNrZXROYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuc291cmNlQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIGJ1Y2tldCBmb3IgQ29kZUJ1aWxkIHNvdXJjZSBzY3JpcHRzJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDREstTmFnIFN1cHByZXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnModGhpcy5zb3VyY2VCdWNrZXQsIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtUzEnLCByZWFzb246ICdTZXJ2ZXIgYWNjZXNzIGxvZ2dpbmcgbm90IGVuYWJsZWQgZm9yIGRldi9kZW1vLicgfSxcbiAgICBdKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyh0aGlzLCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUwxJywgcmVhc29uOiAnTGFtYmRhIHJ1bnRpbWUgdmVyc2lvbiBtYW5hZ2VkIGJ5IENESy4nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLCByZWFzb246ICdBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgaXMgQVdTIGJlc3QgcHJhY3RpY2UuJyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnV2lsZGNhcmQgcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIFMzLCBFQ1IsIENsb3VkV2F0Y2gsIENvZGVCdWlsZC4nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUNCNCcsIHJlYXNvbjogJ0tNUyBlbmNyeXB0aW9uIG5vdCBlbmFibGVkIGZvciBkZXYvZGVtby4nIH0sXG4gICAgXSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgQ29kZUJ1aWxkIHByb2plY3QgdGhhdCBjbG9uZXMgdXBzdHJlYW0gTUNQIHJlcG8sXG4gICAqIGFwcGxpZXMgcGF0Y2ggc2NyaXB0cywgYnVpbGRzIEFSTTY0IERvY2tlciBpbWFnZSxcbiAgICogYW5kIHB1c2hlcyB0byBFQ1IuXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZVRyYW5zZm9ybUJ1aWxkUHJvamVjdChcbiAgICBpZDogc3RyaW5nLFxuICAgIHJlcG9zaXRvcnk6IGVjci5SZXBvc2l0b3J5LFxuICAgIHNvdXJjZVBhdGg6IHN0cmluZyxcbiAgICBidWlsZHNwZWNGaWxlOiBzdHJpbmcsXG4gICk6IGNvZGVidWlsZC5Qcm9qZWN0IHtcbiAgICBjb25zdCBjb2RlQnVpbGRSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsIGAke2lkfUNvZGVCdWlsZFJvbGVgLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnY29kZWJ1aWxkLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiBgSUFNIHJvbGUgZm9yIENvZGVCdWlsZCB0byBidWlsZCAke2lkfSBjb250YWluZXIgaW1hZ2VgLFxuICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgQ2xvdWRXYXRjaExvZ3NQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgIHN0YXRlbWVudHM6IFtuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLCAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLCAnbG9nczpQdXRMb2dFdmVudHMnXSxcbiAgICAgICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHtjZGsuQXdzLlJFR0lPTn06JHtjZGsuQXdzLkFDQ09VTlRfSUR9OmxvZy1ncm91cDovYXdzL2NvZGVidWlsZC8qYF0sXG4gICAgICAgICAgfSldLFxuICAgICAgICB9KSxcbiAgICAgICAgRUNSUHVzaFBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAnZWNyOkJhdGNoQ2hlY2tMYXllckF2YWlsYWJpbGl0eScsICdlY3I6R2V0RG93bmxvYWRVcmxGb3JMYXllcicsICdlY3I6QmF0Y2hHZXRJbWFnZScsXG4gICAgICAgICAgICAgICAgJ2VjcjpQdXRJbWFnZScsICdlY3I6SW5pdGlhdGVMYXllclVwbG9hZCcsICdlY3I6VXBsb2FkTGF5ZXJQYXJ0JywgJ2VjcjpDb21wbGV0ZUxheWVyVXBsb2FkJyxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbcmVwb3NpdG9yeS5yZXBvc2l0b3J5QXJuXSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbiddLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSxcbiAgICAgICAgfSksXG4gICAgICAgIFMzUmVhZFBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0JywgJ3MzOkdldE9iamVjdFZlcnNpb24nXSxcbiAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuc291cmNlQnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXG4gICAgICAgICAgfSldLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5Qcm9qZWN0KHRoaXMsIGAke2lkfUJ1aWxkUHJvamVjdGAsIHtcbiAgICAgIHByb2plY3ROYW1lOiBgY2xvdWRvcHMtJHtpZC50b0xvd2VyQ2FzZSgpfS1idWlsZGAsXG4gICAgICBkZXNjcmlwdGlvbjogYEJ1aWxkIEFSTTY0IGNvbnRhaW5lciBmb3IgJHtpZH0gd2l0aCBzdHJlYW1hYmxlLWh0dHAgdHJhbnNwb3J0YCxcbiAgICAgIHNvdXJjZTogY29kZWJ1aWxkLlNvdXJjZS5zMyh7XG4gICAgICAgIGJ1Y2tldDogdGhpcy5zb3VyY2VCdWNrZXQsXG4gICAgICAgIHBhdGg6IHNvdXJjZVBhdGgsXG4gICAgICB9KSxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tU291cmNlRmlsZW5hbWUoYnVpbGRzcGVjRmlsZSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiBjb2RlYnVpbGQuTGludXhBcm1CdWlsZEltYWdlLkFNQVpPTl9MSU5VWF8yX1NUQU5EQVJEXzNfMCxcbiAgICAgICAgY29tcHV0ZVR5cGU6IGNvZGVidWlsZC5Db21wdXRlVHlwZS5TTUFMTCxcbiAgICAgICAgcHJpdmlsZWdlZDogdHJ1ZSxcbiAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICBBV1NfREVGQVVMVF9SRUdJT046IHsgdmFsdWU6IGNkay5Bd3MuUkVHSU9OIH0sXG4gICAgICAgICAgQVdTX0FDQ09VTlRfSUQ6IHsgdmFsdWU6IGNkay5Bd3MuQUNDT1VOVF9JRCB9LFxuICAgICAgICAgIEVDUl9SRVBPX1VSSTogeyB2YWx1ZTogcmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgcm9sZTogY29kZUJ1aWxkUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSxcbiAgICB9KTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhjb2RlQnVpbGRSb2xlLCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLCByZWFzb246ICdXaWxkY2FyZCBmb3IgZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbiwgUzMsIENsb3VkV2F0Y2ggTG9ncy4nIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMocHJvamVjdCwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1DQjQnLCByZWFzb246ICdLTVMgZW5jcnlwdGlvbiBub3QgZW5hYmxlZCBmb3IgZGV2L2RlbW8uJyB9LFxuICAgIF0pO1xuXG4gICAgcmV0dXJuIHByb2plY3Q7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgdGhlIG1haW4gYWdlbnQgcnVudGltZSBpbWFnZSB1c2luZyBzdGFuZGFyZCBEb2NrZXIgYnVpbGRcbiAgICogKG5vIHBhdGNoaW5nIG5lZWRlZCAtIGl0J3Mgb3VyIG93biBjb2RlKS5cbiAgICovXG4gIHByaXZhdGUgYnVpbGRNYWluUnVudGltZUltYWdlKHNvdXJjZURlcGxveW1lbnQ6IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBidWlsZFByb2plY3QgPSBuZXcgY29kZWJ1aWxkLlByb2plY3QodGhpcywgJ01haW5SdW50aW1lQnVpbGRQcm9qZWN0Jywge1xuICAgICAgcHJvamVjdE5hbWU6ICdjbG91ZG9wcy1tYWlucnVudGltZS1idWlsZCcsXG4gICAgICBzb3VyY2U6IGNvZGVidWlsZC5Tb3VyY2UuczMoe1xuICAgICAgICBidWNrZXQ6IHRoaXMuc291cmNlQnVja2V0LFxuICAgICAgICBwYXRoOiAnYWdlbnRjb3JlLycsXG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5MaW51eEJ1aWxkSW1hZ2UuQU1BWk9OX0xJTlVYXzJfQVJNXzMsXG4gICAgICAgIHByaXZpbGVnZWQ6IHRydWUsXG4gICAgICAgIGNvbXB1dGVUeXBlOiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGUuU01BTEwsXG4gICAgICB9LFxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgQVdTX0RFRkFVTFRfUkVHSU9OOiB7IHZhbHVlOiB0aGlzLnJlZ2lvbiB9LFxuICAgICAgICBBV1NfQUNDT1VOVF9JRDogeyB2YWx1ZTogdGhpcy5hY2NvdW50IH0sXG4gICAgICAgIElNQUdFX1JFUE9fTkFNRTogeyB2YWx1ZTogdGhpcy5yZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lIH0sXG4gICAgICAgIElNQUdFX1RBRzogeyB2YWx1ZTogJ2xhdGVzdCcgfSxcbiAgICAgIH0sXG4gICAgICBidWlsZFNwZWM6IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICAgIHZlcnNpb246ICcwLjInLFxuICAgICAgICBwaGFzZXM6IHtcbiAgICAgICAgICBwcmVfYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIExvZ2dpbmcgaW4gdG8gQW1hem9uIEVDUi4uLicsXG4gICAgICAgICAgICAgICdhd3MgZWNyIGdldC1sb2dpbi1wYXNzd29yZCAtLXJlZ2lvbiAkQVdTX0RFRkFVTFRfUkVHSU9OIHwgZG9ja2VyIGxvZ2luIC0tdXNlcm5hbWUgQVdTIC0tcGFzc3dvcmQtc3RkaW4gJEFXU19BQ0NPVU5UX0lELmRrci5lY3IuJEFXU19ERUZBVUxUX1JFR0lPTi5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gQnVpbGRpbmcgdGhlIERvY2tlciBpbWFnZS4uLicsXG4gICAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLXQgJElNQUdFX1JFUE9fTkFNRTokSU1BR0VfVEFHIC4nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHRhZyAkSU1BR0VfUkVQT19OQU1FOiRJTUFHRV9UQUcgJEFXU19BQ0NPVU5UX0lELmRrci5lY3IuJEFXU19ERUZBVUxUX1JFR0lPTi5hbWF6b25hd3MuY29tLyRJTUFHRV9SRVBPX05BTUU6JElNQUdFX1RBRycsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcG9zdF9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gUHVzaGluZyB0aGUgRG9ja2VyIGltYWdlLi4uJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBwdXNoICRBV1NfQUNDT1VOVF9JRC5ka3IuZWNyLiRBV1NfREVGQVVMVF9SRUdJT04uYW1hem9uYXdzLmNvbS8kSU1BR0VfUkVQT19OQU1FOiRJTUFHRV9UQUcnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlcG9zaXRvcnkuZ3JhbnRQdWxsUHVzaChidWlsZFByb2plY3QpO1xuICAgIHRoaXMuc291cmNlQnVja2V0LmdyYW50UmVhZChidWlsZFByb2plY3QpO1xuICAgIGJ1aWxkUHJvamVjdC5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIGNvbnN0IHRyaWdnZXJGbiA9IG5ldyBjZGsuYXdzX2xhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWFpblJ1bnRpbWVCdWlsZFRyaWdnZXJGbicsIHtcbiAgICAgIHJ1bnRpbWU6IGNkay5hd3NfbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTQsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBjZGsuYXdzX2xhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vbGFtYmRhL2J1aWxkLXRyaWdnZXInKSksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICB9KTtcbiAgICB0cmlnZ2VyRm4uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOlN0YXJ0QnVpbGQnXSxcbiAgICAgIHJlc291cmNlczogW2J1aWxkUHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICB9KSk7XG4gICAgdHJpZ2dlckZuLm5vZGUuYWRkRGVwZW5kZW5jeShzb3VyY2VEZXBsb3ltZW50KTtcblxuICAgIG5ldyBjZGsuQ3VzdG9tUmVzb3VyY2UodGhpcywgJ01haW5SdW50aW1lVHJpZ2dlckJ1aWxkJywge1xuICAgICAgc2VydmljZVRva2VuOiB0cmlnZ2VyRm4uZnVuY3Rpb25Bcm4sXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIFByb2plY3ROYW1lOiBidWlsZFByb2plY3QucHJvamVjdE5hbWUsXG4gICAgICAgIFRpbWVzdGFtcDogYCR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoNyl9YCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoYnVpbGRQcm9qZWN0LCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUNCNCcsIHJlYXNvbjogJ0tNUyBlbmNyeXB0aW9uIG5vdCBlbmFibGVkIGZvciBkZXYvZGVtby4nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLCByZWFzb246ICdXaWxkY2FyZCBmb3IgRUNSLCBTMywgQ2xvdWRXYXRjaC4nIH0sXG4gICAgXSwgdHJ1ZSk7XG4gIH1cbn1cbiJdfQ==