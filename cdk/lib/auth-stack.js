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
exports.AuthStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const cdk_nag_1 = require("cdk-nag");
class AuthStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========================================
        // Cognito User Pool
        // ========================================
        const userPool = new cognito.UserPool(this, 'CloudOpsUserPool', {
            userPoolName: `${this.stackName}-users`,
            selfSignUpEnabled: false,
            signInAliases: {
                email: true,
                username: true,
            },
            autoVerify: {
                email: true,
            },
            userInvitation: {
                emailSubject: 'Your CloudOps Agent Login Credentials',
                emailBody: [
                    '<h2>Welcome to CloudOps Agent</h2>',
                    '<p>Your admin account has been created. You will be prompted to change your password on first login.</p>',
                    '<br/>',
                    '<p><strong>Username</strong></p>',
                    '<p style="font-family: monospace; font-size: 16px; background: #f0f0f0; padding: 8px; display: inline-block;">{username}</p>',
                    '<br/>',
                    '<p><strong>Temporary Password</strong></p>',
                    '<p style="font-family: monospace; font-size: 16px; background: #f0f0f0; padding: 8px; display: inline-block;">{####}</p>',
                ].join('\n'),
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true, // Add symbol requirement for stronger security
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        this.userPoolId = userPool.userPoolId;
        this.userPoolArn = userPool.userPoolArn;
        this.userPoolProviderName = userPool.userPoolProviderName;
        // Add Cognito Domain for OAuth
        const userPoolDomain = userPool.addDomain('CloudOpsDomain', {
            cognitoDomain: {
                domainPrefix: `cloudops-mcp-${this.account}-${cdk.Names.uniqueId(this).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 8)}`,
            },
        });
        // OAuth endpoints for Gateway and AgentCore Identity
        const domainUrl = `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;
        this.oauthTokenEndpoint = `${domainUrl}/oauth2/token`;
        this.oauthAuthorizationEndpoint = `${domainUrl}/oauth2/authorize`;
        this.oauthIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
        // ========================================
        // User Pool Clients
        // ========================================
        // Create Resource Server for M2M authentication (required for client_credentials flow)
        const mcpInvokeScope = {
            scopeName: 'invoke',
            scopeDescription: 'Invoke MCP runtime tools',
        };
        const resourceServer = userPool.addResourceServer('CloudOpsResourceServer', {
            identifier: 'mcp-runtime-server',
            userPoolResourceServerName: `${this.stackName}-resource-server`,
            scopes: [mcpInvokeScope],
        });
        // Client for frontend users (no secret)
        const userPoolClient = userPool.addClient('CloudOpsUserPoolClient', {
            userPoolClientName: `${this.stackName}-client`,
            generateSecret: false,
            authFlows: {
                userPassword: true,
                userSrp: true,
                custom: true,
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                    implicitCodeGrant: true,
                },
                scopes: [
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.PROFILE,
                ],
            },
        });
        this.userPoolClientId = userPoolClient.userPoolClientId;
        // M2M Client for Gateway → MCP Server Runtimes (with secret for client credentials flow)
        const m2mClient = userPool.addClient('CloudOpsM2MClient', {
            userPoolClientName: `${this.stackName}-m2m-client`,
            generateSecret: true,
            authFlows: {
                userPassword: false,
                userSrp: false,
                custom: false,
            },
            oAuth: {
                flows: {
                    clientCredentials: true, // M2M flow
                },
                scopes: [
                    cognito.OAuthScope.resourceServer(resourceServer, mcpInvokeScope),
                ],
            },
        });
        this.oauthClientId = m2mClient.userPoolClientId;
        // ========================================
        // Identity Pool
        // ========================================
        const identityPool = new cognito.CfnIdentityPool(this, 'CloudOpsIdentityPool', {
            identityPoolName: `${this.stackName.replace(/[^a-zA-Z0-9]/g, '_')}_identity_pool`,
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [
                {
                    clientId: userPoolClient.userPoolClientId,
                    providerName: userPool.userPoolProviderName,
                },
                {
                    clientId: m2mClient.userPoolClientId,
                    providerName: userPool.userPoolProviderName,
                },
            ],
        });
        this.identityPoolId = identityPool.ref;
        // ========================================
        // IAM Roles for Identity Pool
        // ========================================
        // Authenticated Role - Can invoke Main Agent Runtime
        const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
            roleName: `${this.stackName}-authenticated-role`,
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                StringEquals: {
                    'cognito-identity.amazonaws.com:aud': identityPool.ref,
                },
                'ForAnyValue:StringLike': {
                    'cognito-identity.amazonaws.com:amr': 'authenticated',
                },
            }, 'sts:AssumeRoleWithWebIdentity'),
        });
        // Note: Runtime ARN will be added after AgentStack is deployed
        // Frontend users will invoke the main agent runtime via IAM
        authenticatedRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:InvokeAgentRuntime',
                'bedrock-agentcore:GetRuntime',
                'bedrock-agentcore:ListRuntimes',
            ],
            resources: [
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/cloudops_billing_mcp*`,
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/cloudops_pricing_mcp*`,
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/cloudops_runtime*`,
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/cloudops_cloudwatch_mcp*`,
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/cloudops_cloudtrail_mcp*`,
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/cloudops_inventory_mcp*`,
            ],
        }));
        // Unauthenticated Role - Deny all
        const unauthenticatedRole = new iam.Role(this, 'UnauthenticatedRole', {
            roleName: `${this.stackName}-unauthenticated-role`,
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                StringEquals: {
                    'cognito-identity.amazonaws.com:aud': identityPool.ref,
                },
                'ForAnyValue:StringLike': {
                    'cognito-identity.amazonaws.com:amr': 'unauthenticated',
                },
            }, 'sts:AssumeRoleWithWebIdentity'),
        });
        unauthenticatedRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.DENY,
            actions: ['*'],
            resources: ['*'],
        }));
        // Attach roles to Identity Pool
        new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
            identityPoolId: identityPool.ref,
            roles: {
                authenticated: authenticatedRole.roleArn,
                unauthenticated: unauthenticatedRole.roleArn,
            },
        });
        // ========================================
        // Admin User
        // ========================================
        new cognito.CfnUserPoolUser(this, 'AdminUser', {
            userPoolId: userPool.userPoolId,
            username: 'admin',
            userAttributes: [
                {
                    name: 'email',
                    value: props.adminEmail,
                },
                {
                    name: 'email_verified',
                    value: 'true',
                },
            ],
            desiredDeliveryMediums: ['EMAIL'],
        });
        // ========================================
        // Outputs
        // ========================================
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.userPoolId,
            description: 'Cognito User Pool ID',
            exportName: `${this.stackName}-UserPoolId`,
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: this.userPoolClientId,
            description: 'Cognito User Pool Client ID',
            exportName: `${this.stackName}-UserPoolClientId`,
        });
        new cdk.CfnOutput(this, 'IdentityPoolId', {
            value: this.identityPoolId,
            description: 'Cognito Identity Pool ID',
            exportName: `${this.stackName}-IdentityPoolId`,
        });
        new cdk.CfnOutput(this, 'UserPoolArn', {
            value: this.userPoolArn,
            description: 'Cognito User Pool ARN',
            exportName: `${this.stackName}-UserPoolArn`,
        });
        new cdk.CfnOutput(this, 'OAuthClientId', {
            value: this.oauthClientId,
            description: 'OAuth Client ID for Gateway',
            exportName: `${this.stackName}-OAuthClientId`,
        });
        new cdk.CfnOutput(this, 'OAuthTokenEndpoint', {
            value: this.oauthTokenEndpoint,
            description: 'OAuth Token Endpoint for Gateway',
            exportName: `${this.stackName}-OAuthTokenEndpoint`,
        });
        new cdk.CfnOutput(this, 'OAuthAuthorizationEndpoint', {
            value: this.oauthAuthorizationEndpoint,
            description: 'OAuth Authorization Endpoint',
            exportName: `${this.stackName}-OAuthAuthorizationEndpoint`,
        });
        new cdk.CfnOutput(this, 'OAuthIssuer', {
            value: this.oauthIssuer,
            description: 'OAuth Issuer URL',
            exportName: `${this.stackName}-OAuthIssuer`,
        });
        new cdk.CfnOutput(this, 'OAuthDiscoveryUrl', {
            value: `${this.oauthIssuer}/.well-known/openid-configuration`,
            description: 'OAuth Discovery URL for M2M authentication',
            exportName: `${this.stackName}-OAuthDiscoveryUrl`,
        });
        new cdk.CfnOutput(this, 'AuthenticatedRoleArn', {
            value: authenticatedRole.roleArn,
            description: 'Authenticated Role ARN',
        });
        new cdk.CfnOutput(this, 'AdminEmail', {
            value: props.adminEmail,
            description: 'Admin user email (temporary password sent via email)',
        });
        new cdk.CfnOutput(this, 'AdminUsername', {
            value: 'admin',
            description: 'Admin username',
        });
        // ========================================
        // OAuth Provider - Created by external Python script after stack deploy
        // ========================================
        this.oauthProviderName = 'cloudops-mcp-oauth-provider';
        this.oauthProviderArn = 'CREATED_BY_SCRIPT'; // Will be read from oauth-provider-arn.txt
        new cdk.CfnOutput(this, 'OAuthProviderName', {
            value: this.oauthProviderName,
            description: 'OAuth Provider Name (created by scripts/create-oauth-provider.py)',
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        // Cognito User Pool suppressions
        cdk_nag_1.NagSuppressions.addResourceSuppressions(userPool, [
            {
                id: 'AwsSolutions-COG2',
                reason: 'MFA not enforced for demo/development environment. Production deployments should enable MFA for enhanced security.',
            },
            {
                id: 'AwsSolutions-COG3',
                reason: 'Advanced security features (compromised credentials check) not required for demo/development environment. Production deployments should enable AdvancedSecurityMode.',
            },
        ], true);
        // Authenticated Role suppressions
        cdk_nag_1.NagSuppressions.addResourceSuppressions(authenticatedRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard required for AgentCore runtime invocation to support all session IDs and conversation turns (runtime ARN with /* suffix)',
            },
        ], true);
        // Stack-level suppressions for CDK-created Lambda functions (Cognito domain custom resource)
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions created by CDK for Cognito domain custom resource',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
            },
            {
                id: 'AwsSolutions-L1',
                reason: 'Lambda function is created and managed by CDK for Cognito domain custom resource - runtime is automatically updated by CDK',
            },
        ]);
    }
}
exports.AuthStack = AuthStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGgtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLGlFQUFtRDtBQUNuRCx5REFBMkM7QUFHM0MscUNBQTBDO0FBTTFDLE1BQWEsU0FBVSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBYXRDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBcUI7UUFDN0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsMkNBQTJDO1FBQzNDLG9CQUFvQjtRQUNwQiwyQ0FBMkM7UUFFM0MsTUFBTSxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUM5RCxZQUFZLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxRQUFRO1lBQ3ZDLGlCQUFpQixFQUFFLEtBQUs7WUFDeEIsYUFBYSxFQUFFO2dCQUNiLEtBQUssRUFBRSxJQUFJO2dCQUNYLFFBQVEsRUFBRSxJQUFJO2FBQ2Y7WUFDRCxVQUFVLEVBQUU7Z0JBQ1YsS0FBSyxFQUFFLElBQUk7YUFDWjtZQUNELGNBQWMsRUFBRTtnQkFDZCxZQUFZLEVBQUUsdUNBQXVDO2dCQUNyRCxTQUFTLEVBQUU7b0JBQ1Qsb0NBQW9DO29CQUNwQywwR0FBMEc7b0JBQzFHLE9BQU87b0JBQ1Asa0NBQWtDO29CQUNsQyw4SEFBOEg7b0JBQzlILE9BQU87b0JBQ1AsNENBQTRDO29CQUM1QywwSEFBMEg7aUJBQzNILENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQzthQUNiO1lBQ0QsY0FBYyxFQUFFO2dCQUNkLFNBQVMsRUFBRSxDQUFDO2dCQUNaLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGFBQWEsRUFBRSxJQUFJO2dCQUNuQixj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IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXV0aFN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGFkbWluRW1haWw6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIEF1dGhTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbElkOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbENsaWVudElkOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBpZGVudGl0eVBvb2xJZDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlclBvb2xBcm46IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sUHJvdmlkZXJOYW1lOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBvYXV0aENsaWVudElkOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBvYXV0aFRva2VuRW5kcG9pbnQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoQXV0aG9yaXphdGlvbkVuZHBvaW50OiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBvYXV0aElzc3Vlcjogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgb2F1dGhQcm92aWRlck5hbWU6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoUHJvdmlkZXJBcm46IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXV0aFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDb2duaXRvIFVzZXIgUG9vbFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IHVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ0Nsb3VkT3BzVXNlclBvb2wnLCB7XG4gICAgICB1c2VyUG9vbE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS11c2Vyc2AsXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogZmFsc2UsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7XG4gICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICB1c2VybmFtZTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBhdXRvVmVyaWZ5OiB7XG4gICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHVzZXJJbnZpdGF0aW9uOiB7XG4gICAgICAgIGVtYWlsU3ViamVjdDogJ1lvdXIgQ2xvdWRPcHMgQWdlbnQgTG9naW4gQ3JlZGVudGlhbHMnLFxuICAgICAgICBlbWFpbEJvZHk6IFtcbiAgICAgICAgICAnPGgyPldlbGNvbWUgdG8gQ2xvdWRPcHMgQWdlbnQ8L2gyPicsXG4gICAgICAgICAgJzxwPllvdXIgYWRtaW4gYWNjb3VudCBoYXMgYmVlbiBjcmVhdGVkLiBZb3Ugd2lsbCBiZSBwcm9tcHRlZCB0byBjaGFuZ2UgeW91ciBwYXNzd29yZCBvbiBmaXJzdCBsb2dpbi48L3A+JyxcbiAgICAgICAgICAnPGJyLz4nLFxuICAgICAgICAgICc8cD48c3Ryb25nPlVzZXJuYW1lPC9zdHJvbmc+PC9wPicsXG4gICAgICAgICAgJzxwIHN0eWxlPVwiZm9udC1mYW1pbHk6IG1vbm9zcGFjZTsgZm9udC1zaXplOiAxNnB4OyBiYWNrZ3JvdW5kOiAjZjBmMGYwOyBwYWRkaW5nOiA4cHg7IGRpc3BsYXk6IGlubGluZS1ibG9jaztcIj57dXNlcm5hbWV9PC9wPicsXG4gICAgICAgICAgJzxici8+JyxcbiAgICAgICAgICAnPHA+PHN0cm9uZz5UZW1wb3JhcnkgUGFzc3dvcmQ8L3N0cm9uZz48L3A+JyxcbiAgICAgICAgICAnPHAgc3R5bGU9XCJmb250LWZhbWlseTogbW9ub3NwYWNlOyBmb250LXNpemU6IDE2cHg7IGJhY2tncm91bmQ6ICNmMGYwZjA7IHBhZGRpbmc6IDhweDsgZGlzcGxheTogaW5saW5lLWJsb2NrO1wiPnsjIyMjfTwvcD4nLFxuICAgICAgICBdLmpvaW4oJ1xcbicpLFxuICAgICAgfSxcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVVwcGVyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IHRydWUsIC8vIEFkZCBzeW1ib2wgcmVxdWlyZW1lbnQgZm9yIHN0cm9uZ2VyIHNlY3VyaXR5XG4gICAgICB9LFxuICAgICAgYWNjb3VudFJlY292ZXJ5OiBjb2duaXRvLkFjY291bnRSZWNvdmVyeS5FTUFJTF9PTkxZLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIHRoaXMudXNlclBvb2xJZCA9IHVzZXJQb29sLnVzZXJQb29sSWQ7XG4gICAgdGhpcy51c2VyUG9vbEFybiA9IHVzZXJQb29sLnVzZXJQb29sQXJuO1xuICAgIHRoaXMudXNlclBvb2xQcm92aWRlck5hbWUgPSB1c2VyUG9vbC51c2VyUG9vbFByb3ZpZGVyTmFtZTtcblxuICAgIC8vIEFkZCBDb2duaXRvIERvbWFpbiBmb3IgT0F1dGhcbiAgICBjb25zdCB1c2VyUG9vbERvbWFpbiA9IHVzZXJQb29sLmFkZERvbWFpbignQ2xvdWRPcHNEb21haW4nLCB7XG4gICAgICBjb2duaXRvRG9tYWluOiB7XG4gICAgICAgIGRvbWFpblByZWZpeDogYGNsb3Vkb3BzLW1jcC0ke3RoaXMuYWNjb3VudH0tJHtjZGsuTmFtZXMudW5pcXVlSWQodGhpcykudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV0vZywgJycpLnN1YnN0cmluZygwLCA4KX1gLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIE9BdXRoIGVuZHBvaW50cyBmb3IgR2F0ZXdheSBhbmQgQWdlbnRDb3JlIElkZW50aXR5XG4gICAgY29uc3QgZG9tYWluVXJsID0gYGh0dHBzOi8vJHt1c2VyUG9vbERvbWFpbi5kb21haW5OYW1lfS5hdXRoLiR7dGhpcy5yZWdpb259LmFtYXpvbmNvZ25pdG8uY29tYDtcbiAgICB0aGlzLm9hdXRoVG9rZW5FbmRwb2ludCA9IGAke2RvbWFpblVybH0vb2F1dGgyL3Rva2VuYDtcbiAgICB0aGlzLm9hdXRoQXV0aG9yaXphdGlvbkVuZHBvaW50ID0gYCR7ZG9tYWluVXJsfS9vYXV0aDIvYXV0aG9yaXplYDtcbiAgICB0aGlzLm9hdXRoSXNzdWVyID0gYGh0dHBzOi8vY29nbml0by1pZHAuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3VzZXJQb29sLnVzZXJQb29sSWR9YDtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBVc2VyIFBvb2wgQ2xpZW50c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENyZWF0ZSBSZXNvdXJjZSBTZXJ2ZXIgZm9yIE0yTSBhdXRoZW50aWNhdGlvbiAocmVxdWlyZWQgZm9yIGNsaWVudF9jcmVkZW50aWFscyBmbG93KVxuICAgIGNvbnN0IG1jcEludm9rZVNjb3BlOiBjb2duaXRvLlJlc291cmNlU2VydmVyU2NvcGUgPSB7XG4gICAgICBzY29wZU5hbWU6ICdpbnZva2UnLFxuICAgICAgc2NvcGVEZXNjcmlwdGlvbjogJ0ludm9rZSBNQ1AgcnVudGltZSB0b29scycsXG4gICAgfTtcblxuICAgIGNvbnN0IHJlc291cmNlU2VydmVyID0gdXNlclBvb2wuYWRkUmVzb3VyY2VTZXJ2ZXIoJ0Nsb3VkT3BzUmVzb3VyY2VTZXJ2ZXInLCB7XG4gICAgICBpZGVudGlmaWVyOiAnbWNwLXJ1bnRpbWUtc2VydmVyJyxcbiAgICAgIHVzZXJQb29sUmVzb3VyY2VTZXJ2ZXJOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tcmVzb3VyY2Utc2VydmVyYCxcbiAgICAgIHNjb3BlczogW21jcEludm9rZVNjb3BlXSxcbiAgICB9KTtcblxuICAgIC8vIENsaWVudCBmb3IgZnJvbnRlbmQgdXNlcnMgKG5vIHNlY3JldClcbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IHVzZXJQb29sLmFkZENsaWVudCgnQ2xvdWRPcHNVc2VyUG9vbENsaWVudCcsIHtcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LWNsaWVudGAsXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsXG4gICAgICBhdXRoRmxvd3M6IHtcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxuICAgICAgICB1c2VyU3JwOiB0cnVlLFxuICAgICAgICBjdXN0b206IHRydWUsXG4gICAgICB9LFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBhdXRob3JpemF0aW9uQ29kZUdyYW50OiB0cnVlLFxuICAgICAgICAgIGltcGxpY2l0Q29kZUdyYW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUwsXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLk9QRU5JRCxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuUFJPRklMRSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50SWQgPSB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkO1xuXG4gICAgLy8gTTJNIENsaWVudCBmb3IgR2F0ZXdheSDihpIgTUNQIFNlcnZlciBSdW50aW1lcyAod2l0aCBzZWNyZXQgZm9yIGNsaWVudCBjcmVkZW50aWFscyBmbG93KVxuICAgIGNvbnN0IG0ybUNsaWVudCA9IHVzZXJQb29sLmFkZENsaWVudCgnQ2xvdWRPcHNNMk1DbGllbnQnLCB7XG4gICAgICB1c2VyUG9vbENsaWVudE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1tMm0tY2xpZW50YCxcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiB0cnVlLFxuICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgIHVzZXJQYXNzd29yZDogZmFsc2UsXG4gICAgICAgIHVzZXJTcnA6IGZhbHNlLFxuICAgICAgICBjdXN0b206IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIG9BdXRoOiB7XG4gICAgICAgIGZsb3dzOiB7XG4gICAgICAgICAgY2xpZW50Q3JlZGVudGlhbHM6IHRydWUsIC8vIE0yTSBmbG93XG4gICAgICAgIH0sXG4gICAgICAgIHNjb3BlczogW1xuICAgICAgICAgIGNvZ25pdG8uT0F1dGhTY29wZS5yZXNvdXJjZVNlcnZlcihyZXNvdXJjZVNlcnZlciwgbWNwSW52b2tlU2NvcGUpLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMub2F1dGhDbGllbnRJZCA9IG0ybUNsaWVudC51c2VyUG9vbENsaWVudElkO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIElkZW50aXR5IFBvb2xcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBpZGVudGl0eVBvb2wgPSBuZXcgY29nbml0by5DZm5JZGVudGl0eVBvb2wodGhpcywgJ0Nsb3VkT3BzSWRlbnRpdHlQb29sJywge1xuICAgICAgaWRlbnRpdHlQb29sTmFtZTogYCR7dGhpcy5zdGFja05hbWUucmVwbGFjZSgvW15hLXpBLVowLTldL2csICdfJyl9X2lkZW50aXR5X3Bvb2xgLFxuICAgICAgYWxsb3dVbmF1dGhlbnRpY2F0ZWRJZGVudGl0aWVzOiBmYWxzZSxcbiAgICAgIGNvZ25pdG9JZGVudGl0eVByb3ZpZGVyczogW1xuICAgICAgICB7XG4gICAgICAgICAgY2xpZW50SWQ6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgICAgcHJvdmlkZXJOYW1lOiB1c2VyUG9vbC51c2VyUG9vbFByb3ZpZGVyTmFtZSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNsaWVudElkOiBtMm1DbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgICBwcm92aWRlck5hbWU6IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIHRoaXMuaWRlbnRpdHlQb29sSWQgPSBpZGVudGl0eVBvb2wucmVmO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIElBTSBSb2xlcyBmb3IgSWRlbnRpdHkgUG9vbFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIEF1dGhlbnRpY2F0ZWQgUm9sZSAtIENhbiBpbnZva2UgTWFpbiBBZ2VudCBSdW50aW1lXG4gICAgY29uc3QgYXV0aGVudGljYXRlZFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0F1dGhlbnRpY2F0ZWRSb2xlJywge1xuICAgICAgcm9sZU5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1hdXRoZW50aWNhdGVkLXJvbGVgLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcbiAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogaWRlbnRpdHlQb29sLnJlZixcbiAgICAgICAgICB9LFxuICAgICAgICAgICdGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlJzoge1xuICAgICAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXInOiAnYXV0aGVudGljYXRlZCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgJ3N0czpBc3N1bWVSb2xlV2l0aFdlYklkZW50aXR5J1xuICAgICAgKSxcbiAgICB9KTtcblxuICAgIC8vIE5vdGU6IFJ1bnRpbWUgQVJOIHdpbGwgYmUgYWRkZWQgYWZ0ZXIgQWdlbnRTdGFjayBpcyBkZXBsb3llZFxuICAgIC8vIEZyb250ZW5kIHVzZXJzIHdpbGwgaW52b2tlIHRoZSBtYWluIGFnZW50IHJ1bnRpbWUgdmlhIElBTVxuICAgIGF1dGhlbnRpY2F0ZWRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkludm9rZUFnZW50UnVudGltZScsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRSdW50aW1lJyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkxpc3RSdW50aW1lcycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpydW50aW1lL2Nsb3Vkb3BzX2JpbGxpbmdfbWNwKmAsXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpydW50aW1lL2Nsb3Vkb3BzX3ByaWNpbmdfbWNwKmAsXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpydW50aW1lL2Nsb3Vkb3BzX3J1bnRpbWUqYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJ1bnRpbWUvY2xvdWRvcHNfY2xvdWR3YXRjaF9tY3AqYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJ1bnRpbWUvY2xvdWRvcHNfY2xvdWR0cmFpbF9tY3AqYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJ1bnRpbWUvY2xvdWRvcHNfaW52ZW50b3J5X21jcCpgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBVbmF1dGhlbnRpY2F0ZWQgUm9sZSAtIERlbnkgYWxsXG4gICAgY29uc3QgdW5hdXRoZW50aWNhdGVkUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVW5hdXRoZW50aWNhdGVkUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tdW5hdXRoZW50aWNhdGVkLXJvbGVgLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcbiAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogaWRlbnRpdHlQb29sLnJlZixcbiAgICAgICAgICB9LFxuICAgICAgICAgICdGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlJzoge1xuICAgICAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXInOiAndW5hdXRoZW50aWNhdGVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICAnc3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHknXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgdW5hdXRoZW50aWNhdGVkUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuREVOWSxcbiAgICAgIGFjdGlvbnM6IFsnKiddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBBdHRhY2ggcm9sZXMgdG8gSWRlbnRpdHkgUG9vbFxuICAgIG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMsICdJZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudCcsIHtcbiAgICAgIGlkZW50aXR5UG9vbElkOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgcm9sZXM6IHtcbiAgICAgICAgYXV0aGVudGljYXRlZDogYXV0aGVudGljYXRlZFJvbGUucm9sZUFybixcbiAgICAgICAgdW5hdXRoZW50aWNhdGVkOiB1bmF1dGhlbnRpY2F0ZWRSb2xlLnJvbGVBcm4sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFkbWluIFVzZXJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY29nbml0by5DZm5Vc2VyUG9vbFVzZXIodGhpcywgJ0FkbWluVXNlcicsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICB1c2VybmFtZTogJ2FkbWluJyxcbiAgICAgIHVzZXJBdHRyaWJ1dGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnZW1haWwnLFxuICAgICAgICAgIHZhbHVlOiBwcm9wcy5hZG1pbkVtYWlsLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2VtYWlsX3ZlcmlmaWVkJyxcbiAgICAgICAgICB2YWx1ZTogJ3RydWUnLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGRlc2lyZWREZWxpdmVyeU1lZGl1bXM6IFsnRU1BSUwnXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbElkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tVXNlclBvb2xJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIENsaWVudCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tVXNlclBvb2xDbGllbnRJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSWRlbnRpdHlQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5pZGVudGl0eVBvb2xJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBJZGVudGl0eSBQb29sIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1JZGVudGl0eVBvb2xJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1Vc2VyUG9vbEFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhDbGllbnRJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9hdXRoQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ09BdXRoIENsaWVudCBJRCBmb3IgR2F0ZXdheScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhDbGllbnRJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhUb2tlbkVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMub2F1dGhUb2tlbkVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBUb2tlbiBFbmRwb2ludCBmb3IgR2F0ZXdheScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhUb2tlbkVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPQXV0aEF1dGhvcml6YXRpb25FbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9hdXRoQXV0aG9yaXphdGlvbkVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBBdXRob3JpemF0aW9uIEVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1PQXV0aEF1dGhvcml6YXRpb25FbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhJc3N1ZXInLCB7XG4gICAgICB2YWx1ZTogdGhpcy5vYXV0aElzc3VlcixcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0F1dGggSXNzdWVyIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhJc3N1ZXJgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09BdXRoRGlzY292ZXJ5VXJsJywge1xuICAgICAgdmFsdWU6IGAke3RoaXMub2F1dGhJc3N1ZXJ9Ly53ZWxsLWtub3duL29wZW5pZC1jb25maWd1cmF0aW9uYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0F1dGggRGlzY292ZXJ5IFVSTCBmb3IgTTJNIGF1dGhlbnRpY2F0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1PQXV0aERpc2NvdmVyeVVybGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXV0aGVudGljYXRlZFJvbGVBcm4nLCB7XG4gICAgICB2YWx1ZTogYXV0aGVudGljYXRlZFJvbGUucm9sZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXV0aGVudGljYXRlZCBSb2xlIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWRtaW5FbWFpbCcsIHtcbiAgICAgIHZhbHVlOiBwcm9wcy5hZG1pbkVtYWlsLFxuICAgICAgZGVzY3JpcHRpb246ICdBZG1pbiB1c2VyIGVtYWlsICh0ZW1wb3JhcnkgcGFzc3dvcmQgc2VudCB2aWEgZW1haWwpJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZG1pblVzZXJuYW1lJywge1xuICAgICAgdmFsdWU6ICdhZG1pbicsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FkbWluIHVzZXJuYW1lJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPQXV0aCBQcm92aWRlciAtIENyZWF0ZWQgYnkgZXh0ZXJuYWwgUHl0aG9uIHNjcmlwdCBhZnRlciBzdGFjayBkZXBsb3lcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICB0aGlzLm9hdXRoUHJvdmlkZXJOYW1lID0gJ2Nsb3Vkb3BzLW1jcC1vYXV0aC1wcm92aWRlcic7XG4gICAgdGhpcy5vYXV0aFByb3ZpZGVyQXJuID0gJ0NSRUFURURfQllfU0NSSVBUJzsgLy8gV2lsbCBiZSByZWFkIGZyb20gb2F1dGgtcHJvdmlkZXItYXJuLnR4dFxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09BdXRoUHJvdmlkZXJOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMub2F1dGhQcm92aWRlck5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ09BdXRoIFByb3ZpZGVyIE5hbWUgKGNyZWF0ZWQgYnkgc2NyaXB0cy9jcmVhdGUtb2F1dGgtcHJvdmlkZXIucHkpJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDREstTmFnIFN1cHByZXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENvZ25pdG8gVXNlciBQb29sIHN1cHByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh1c2VyUG9vbCwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DT0cyJyxcbiAgICAgICAgcmVhc29uOiAnTUZBIG5vdCBlbmZvcmNlZCBmb3IgZGVtby9kZXZlbG9wbWVudCBlbnZpcm9ubWVudC4gUHJvZHVjdGlvbiBkZXBsb3ltZW50cyBzaG91bGQgZW5hYmxlIE1GQSBmb3IgZW5oYW5jZWQgc2VjdXJpdHkuJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzMnLFxuICAgICAgICByZWFzb246ICdBZHZhbmNlZCBzZWN1cml0eSBmZWF0dXJlcyAoY29tcHJvbWlzZWQgY3JlZGVudGlhbHMgY2hlY2spIG5vdCByZXF1aXJlZCBmb3IgZGVtby9kZXZlbG9wbWVudCBlbnZpcm9ubWVudC4gUHJvZHVjdGlvbiBkZXBsb3ltZW50cyBzaG91bGQgZW5hYmxlIEFkdmFuY2VkU2VjdXJpdHlNb2RlLicsXG4gICAgICB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgLy8gQXV0aGVudGljYXRlZCBSb2xlIHN1cHByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhhdXRoZW50aWNhdGVkUm9sZSwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgcmVxdWlyZWQgZm9yIEFnZW50Q29yZSBydW50aW1lIGludm9jYXRpb24gdG8gc3VwcG9ydCBhbGwgc2Vzc2lvbiBJRHMgYW5kIGNvbnZlcnNhdGlvbiB0dXJucyAocnVudGltZSBBUk4gd2l0aCAvKiBzdWZmaXgpJyxcbiAgICAgIH0sXG4gICAgXSwgdHJ1ZSk7XG5cblxuXG4gICAgLy8gU3RhY2stbGV2ZWwgc3VwcHJlc3Npb25zIGZvciBDREstY3JlYXRlZCBMYW1iZGEgZnVuY3Rpb25zIChDb2duaXRvIGRvbWFpbiBjdXN0b20gcmVzb3VyY2UpXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFN0YWNrU3VwcHJlc3Npb25zKHRoaXMsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgIHJlYXNvbjogJ0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBtYW5hZ2VkIHBvbGljeSBpcyBBV1MgYmVzdCBwcmFjdGljZSBmb3IgTGFtYmRhIGZ1bmN0aW9ucyBjcmVhdGVkIGJ5IENESyBmb3IgQ29nbml0byBkb21haW4gY3VzdG9tIHJlc291cmNlJyxcbiAgICAgICAgYXBwbGllc1RvOiBbJ1BvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnXSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUwxJyxcbiAgICAgICAgcmVhc29uOiAnTGFtYmRhIGZ1bmN0aW9uIGlzIGNyZWF0ZWQgYW5kIG1hbmFnZWQgYnkgQ0RLIGZvciBDb2duaXRvIGRvbWFpbiBjdXN0b20gcmVzb3VyY2UgLSBydW50aW1lIGlzIGF1dG9tYXRpY2FsbHkgdXBkYXRlZCBieSBDREsnLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxufVxuIl19