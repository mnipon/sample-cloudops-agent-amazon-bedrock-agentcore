#!/usr/bin/env node
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
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const image_stack_1 = require("../lib/image-stack");
const auth_stack_1 = require("../lib/auth-stack");
const mcp_runtime_stack_1 = require("../lib/mcp-runtime-stack");
const gateway_stack_1 = require("../lib/gateway-stack");
const agent_runtime_stack_1 = require("../lib/agent-runtime-stack");
const conversation_history_stack_1 = require("../lib/conversation-history-stack");
const app = new cdk.App();
// Add CDK-Nag AWS Solutions checks
aws_cdk_lib_1.Aspects.of(app).add(new cdk_nag_1.AwsSolutionsChecks({ verbose: true }));
// Get configuration from context or environment
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};
const adminEmail = process.env.COGNITO_ADMIN_EMAIL || app.node.tryGetContext('adminEmail');
const eolTableName = process.env.EOL_TABLE_NAME || app.node.tryGetContext('eolTableName');
if (!adminEmail) {
    console.error('\n❌ ERROR: COGNITO_ADMIN_EMAIL environment variable is required.');
    console.error('Please set it before deploying:');
    console.error('  export COGNITO_ADMIN_EMAIL="your-email@example.com"');
    console.error('  cdk deploy\n');
    throw new Error('COGNITO_ADMIN_EMAIL environment variable is required. Set it before deploying.');
}
// ========================================
// Validated Deployment Sequence
// ========================================
// Stack 1: Image Stack - Builds Docker images for Agent Runtimes
const imageStack = new image_stack_1.ImageStack(app, 'CloudOpsImageStack', {
    env,
    description: 'CloudOps Agent - Docker Image Build (ECR + CodeBuild)',
});
// Stack 2: Auth Stack - Cognito + M2M + OAuth Provider (Custom Resource)
const authStack = new auth_stack_1.AuthStack(app, 'CloudOpsAuthStack', {
    env,
    description: 'CloudOps Agent - Cognito Authentication + OAuth Provider',
    adminEmail: adminEmail,
});
// Stack 3: MCP Runtime Stack - Deploy 5 MCP Runtimes with JWT auth
const mcpRuntimeStack = new mcp_runtime_stack_1.MCPRuntimeStack(app, 'CloudOpsMCPRuntimeStack', {
    env,
    description: 'CloudOps Agent - MCP Server Runtimes (Billing + Pricing + CloudWatch + CloudTrail + Inventory) with JWT Authorization',
    billingMcpRepository: imageStack.billingMcpRepository,
    pricingMcpRepository: imageStack.pricingMcpRepository,
    cloudwatchMcpRepository: imageStack.cloudwatchMcpRepository,
    cloudtrailMcpRepository: imageStack.cloudtrailMcpRepository,
    inventoryMcpRepository: imageStack.inventoryMcpRepository,
    userPoolId: authStack.userPoolId,
    m2mClientId: authStack.oauthClientId,
    ...(eolTableName && { eolTableName }),
});
mcpRuntimeStack.addDependency(imageStack);
mcpRuntimeStack.addDependency(authStack);
// Stack 4: AgentCore Gateway Stack - Gateway + its own Cognito + OAuth provider + MCP targets
const agentCoreGatewayStack = new gateway_stack_1.AgentCoreGatewayStack(app, 'CloudOpsAgentCoreGatewayStack', {
    env,
    description: 'CloudOps Agent - Gateway with MCP Server Targets',
    billingMcpRuntimeArn: mcpRuntimeStack.billingMcpRuntimeArn,
    pricingMcpRuntimeArn: mcpRuntimeStack.pricingMcpRuntimeArn,
    billingMcpRuntimeEndpoint: mcpRuntimeStack.billingMcpRuntimeEndpoint,
    pricingMcpRuntimeEndpoint: mcpRuntimeStack.pricingMcpRuntimeEndpoint,
    cloudwatchMcpRuntimeArn: mcpRuntimeStack.cloudwatchMcpRuntimeArn,
    cloudwatchMcpRuntimeEndpoint: mcpRuntimeStack.cloudwatchMcpRuntimeEndpoint,
    cloudtrailMcpRuntimeArn: mcpRuntimeStack.cloudtrailMcpRuntimeArn,
    cloudtrailMcpRuntimeEndpoint: mcpRuntimeStack.cloudtrailMcpRuntimeEndpoint,
    inventoryMcpRuntimeArn: mcpRuntimeStack.inventoryMcpRuntimeArn,
    inventoryMcpRuntimeEndpoint: mcpRuntimeStack.inventoryMcpRuntimeEndpoint,
    // AuthStack Cognito for outbound OAuth to runtimes
    authUserPoolId: authStack.userPoolId,
    authUserPoolArn: authStack.userPoolArn,
    authM2mClientId: authStack.oauthClientId,
});
agentCoreGatewayStack.addDependency(mcpRuntimeStack);
agentCoreGatewayStack.addDependency(authStack);
// Stack 5: Main Runtime Stack - Main agent runtime with Gateway ARN
const agentRuntimeStack = new agent_runtime_stack_1.AgentRuntimeStack(app, 'CloudOpsAgentRuntimeStack', {
    env,
    description: 'CloudOps Agent - Main Agent Runtime with Gateway Integration',
    repository: imageStack.repository,
    userPoolArn: authStack.userPoolArn,
    gatewayArn: agentCoreGatewayStack.gatewayArn,
    userPoolId: authStack.userPoolId,
    userPoolClientId: authStack.userPoolClientId,
    identityPoolId: authStack.identityPoolId,
});
agentRuntimeStack.addDependency(imageStack);
agentRuntimeStack.addDependency(authStack);
agentRuntimeStack.addDependency(agentCoreGatewayStack);
// Stack 6: Conversation History - DynamoDB + API Gateway for conversation persistence
const conversationHistoryStack = new conversation_history_stack_1.ConversationHistoryStack(app, 'CloudOpsConversationHistoryStack', {
    env,
    description: 'CloudOps Agent - Conversation History (DynamoDB + API Gateway)',
    userPoolArn: authStack.userPoolArn,
    userPoolId: authStack.userPoolId,
});
conversationHistoryStack.addDependency(authStack);
// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'CloudOpsAgent');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLHVDQUFxQztBQUNyQyxpREFBbUM7QUFDbkMsNkNBQXNDO0FBQ3RDLHFDQUE2QztBQUM3QyxvREFBZ0Q7QUFDaEQsa0RBQThDO0FBQzlDLGdFQUEyRDtBQUMzRCx3REFBNkQ7QUFDN0Qsb0VBQStEO0FBQy9ELGtGQUE2RTtBQUU3RSxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQixtQ0FBbUM7QUFDbkMscUJBQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksNEJBQWtCLENBQUMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBRS9ELGdEQUFnRDtBQUNoRCxNQUFNLEdBQUcsR0FBRztJQUNWLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtJQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO0NBQ3RELENBQUM7QUFFRixNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzNGLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxDQUFDO0FBRTFGLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUNoQixPQUFPLENBQUMsS0FBSyxDQUFDLGtFQUFrRSxDQUFDLENBQUM7SUFDbEYsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0lBQ2pELE9BQU8sQ0FBQyxLQUFLLENB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SUFDaEMsZ0JBQWdCLEVBQUUsU0FBUyxDQUFDLGdCQUFnQjtJQUM1QyxjQUFjLEVBQUUsU0FBUyxDQUFDLGNBQWM7Q0FDekMsQ0FBQyxDQUFDO0FBQ0gsaUJBQWlCLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQzVDLGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUMzQyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMscUJBQXFCLENBQUMsQ0FBQztBQUV2RCxzRkFBc0Y7QUFDdEYsTUFBTSx3QkFBd0IsR0FBRyxJQUFJLHFEQUF3QixDQUFDLEdBQUcsRUFBRSxrQ0FBa0MsRUFBRTtJQUNyRyxHQUFHO0lBQ0gsV0FBVyxFQUFFLGdFQUFnRTtJQUM3RSxXQUFXLEVBQUUsU0FBUyxDQUFDLFdBQVc7SUFDbEMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVO0NBQ2pDLENBQUMsQ0FBQztBQUNILHdCQUF3QixDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUVsRCx5QkFBeUI7QUFDekIsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxlQUFlLENBQUMsQ0FBQztBQUNqRCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEFzcGVjdHMgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBBd3NTb2x1dGlvbnNDaGVja3MgfSBmcm9tICdjZGstbmFnJztcbmltcG9ydCB7IEltYWdlU3RhY2sgfSBmcm9tICcuLi9saWIvaW1hZ2Utc3RhY2snO1xuaW1wb3J0IHsgQXV0aFN0YWNrIH0gZnJvbSAnLi4vbGliL2F1dGgtc3RhY2snO1xuaW1wb3J0IHsgTUNQUnVudGltZVN0YWNrIH0gZnJvbSAnLi4vbGliL21jcC1ydW50aW1lLXN0YWNrJztcbmltcG9ydCB7IEFnZW50Q29yZUdhdGV3YXlTdGFjayB9IGZyb20gJy4uL2xpYi9nYXRld2F5LXN0YWNrJztcbmltcG9ydCB7IEFnZW50UnVudGltZVN0YWNrIH0gZnJvbSAnLi4vbGliL2FnZW50LXJ1bnRpbWUtc3RhY2snO1xuaW1wb3J0IHsgQ29udmVyc2F0aW9uSGlzdG9yeVN0YWNrIH0gZnJvbSAnLi4vbGliL2NvbnZlcnNhdGlvbi1oaXN0b3J5LXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gQWRkIENESy1OYWcgQVdTIFNvbHV0aW9ucyBjaGVja3NcbkFzcGVjdHMub2YoYXBwKS5hZGQobmV3IEF3c1NvbHV0aW9uc0NoZWNrcyh7IHZlcmJvc2U6IHRydWUgfSkpO1xuXG4vLyBHZXQgY29uZmlndXJhdGlvbiBmcm9tIGNvbnRleHQgb3IgZW52aXJvbm1lbnRcbmNvbnN0IGVudiA9IHtcbiAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gfHwgJ3VzLWVhc3QtMScsXG59O1xuXG5jb25zdCBhZG1pbkVtYWlsID0gcHJvY2Vzcy5lbnYuQ09HTklUT19BRE1JTl9FTUFJTCB8fCBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdhZG1pbkVtYWlsJyk7XG5jb25zdCBlb2xUYWJsZU5hbWUgPSBwcm9jZXNzLmVudi5FT0xfVEFCTEVfTkFNRSB8fCBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlb2xUYWJsZU5hbWUnKTtcblxuaWYgKCFhZG1pbkVtYWlsKSB7XG4gIGNvbnNvbGUuZXJyb3IoJ1xcbuKdjCBFUlJPUjogQ09HTklUT19BRE1JTl9FTUFJTCBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZC4nKTtcbiAgY29uc29sZS5lcnJvcignUGxlYXNlIHNldCBpdCBiZWZvcmUgZGVwbG95aW5nOicpO1xuICBjb25zb2xlLmVycm9yKCcgIGV4cG9ydCBDT0dOSVRPX0FETUlOX0VNQUlMPVwieW91ci1lbWFpbEBleGFtcGxlLmNvbVwiJyk7XG4gIGNvbnNvbGUuZXJyb3IoJyAgY2RrIGRlcGxveVxcbicpO1xuICB0aHJvdyBuZXcgRXJyb3IoJ0NPR05JVE9fQURNSU5fRU1BSUwgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQuIFNldCBpdCBiZWZvcmUgZGVwbG95aW5nLicpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWYWxpZGF0ZWQgRGVwbG95bWVudCBTZXF1ZW5jZVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBTdGFjayAxOiBJbWFnZSBTdGFjayAtIEJ1aWxkcyBEb2NrZXIgaW1hZ2VzIGZvciBBZ2VudCBSdW50aW1lc1xuY29uc3QgaW1hZ2VTdGFjayA9IG5ldyBJbWFnZVN0YWNrKGFwcCwgJ0Nsb3VkT3BzSW1hZ2VTdGFjaycsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Nsb3VkT3BzIEFnZW50IC0gRG9ja2VyIEltYWdlIEJ1aWxkIChFQ1IgKyBDb2RlQnVpbGQpJyxcbn0pO1xuXG4vLyBTdGFjayAyOiBBdXRoIFN0YWNrIC0gQ29nbml0byArIE0yTSArIE9BdXRoIFByb3ZpZGVyIChDdXN0b20gUmVzb3VyY2UpXG5jb25zdCBhdXRoU3RhY2sgPSBuZXcgQXV0aFN0YWNrKGFwcCwgJ0Nsb3VkT3BzQXV0aFN0YWNrJywge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnQ2xvdWRPcHMgQWdlbnQgLSBDb2duaXRvIEF1dGhlbnRpY2F0aW9uICsgT0F1dGggUHJvdmlkZXInLFxuICBhZG1pbkVtYWlsOiBhZG1pbkVtYWlsLFxufSk7XG5cbi8vIFN0YWNrIDM6IE1DUCBSdW50aW1lIFN0YWNrIC0gRGVwbG95IDUgTUNQIFJ1bnRpbWVzIHdpdGggSldUIGF1dGhcbmNvbnN0IG1jcFJ1bnRpbWVTdGFjayA9IG5ldyBNQ1BSdW50aW1lU3RhY2soYXBwLCAnQ2xvdWRPcHNNQ1BSdW50aW1lU3RhY2snLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdDbG91ZE9wcyBBZ2VudCAtIE1DUCBTZXJ2ZXIgUnVudGltZXMgKEJpbGxpbmcgKyBQcmljaW5nICsgQ2xvdWRXYXRjaCArIENsb3VkVHJhaWwgKyBJbnZlbnRvcnkpIHdpdGggSldUIEF1dGhvcml6YXRpb24nLFxuICBiaWxsaW5nTWNwUmVwb3NpdG9yeTogaW1hZ2VTdGFjay5iaWxsaW5nTWNwUmVwb3NpdG9yeSxcbiAgcHJpY2luZ01jcFJlcG9zaXRvcnk6IGltYWdlU3RhY2sucHJpY2luZ01jcFJlcG9zaXRvcnksXG4gIGNsb3Vkd2F0Y2hNY3BSZXBvc2l0b3J5OiBpbWFnZVN0YWNrLmNsb3Vkd2F0Y2hNY3BSZXBvc2l0b3J5LFxuICBjbG91ZHRyYWlsTWNwUmVwb3NpdG9yeTogaW1hZ2VTdGFjay5jbG91ZHRyYWlsTWNwUmVwb3NpdG9yeSxcbiAgaW52ZW50b3J5TWNwUmVwb3NpdG9yeTogaW1hZ2VTdGFjay5pbnZlbnRvcnlNY3BSZXBvc2l0b3J5LFxuICB1c2VyUG9vbElkOiBhdXRoU3RhY2sudXNlclBvb2xJZCxcbiAgbTJtQ2xpZW50SWQ6IGF1dGhTdGFjay5vYXV0aENsaWVudElkLFxuICAuLi4oZW9sVGFibGVOYW1lICYmIHsgZW9sVGFibGVOYW1lIH0pLFxufSk7XG5tY3BSdW50aW1lU3RhY2suYWRkRGVwZW5kZW5jeShpbWFnZVN0YWNrKTtcbm1jcFJ1bnRpbWVTdGFjay5hZGREZXBlbmRlbmN5KGF1dGhTdGFjayk7XG5cbi8vIFN0YWNrIDQ6IEFnZW50Q29yZSBHYXRld2F5IFN0YWNrIC0gR2F0ZXdheSArIGl0cyBvd24gQ29nbml0byArIE9BdXRoIHByb3ZpZGVyICsgTUNQIHRhcmdldHNcbmNvbnN0IGFnZW50Q29yZUdhdGV3YXlTdGFjayA9IG5ldyBBZ2VudENvcmVHYXRld2F5U3RhY2soYXBwLCAnQ2xvdWRPcHNBZ2VudENvcmVHYXRld2F5U3RhY2snLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdDbG91ZE9wcyBBZ2VudCAtIEdhdGV3YXkgd2l0aCBNQ1AgU2VydmVyIFRhcmdldHMnLFxuICBiaWxsaW5nTWNwUnVudGltZUFybjogbWNwUnVudGltZVN0YWNrLmJpbGxpbmdNY3BSdW50aW1lQXJuLFxuICBwcmljaW5nTWNwUnVudGltZUFybjogbWNwUnVudGltZVN0YWNrLnByaWNpbmdNY3BSdW50aW1lQXJuLFxuICBiaWxsaW5nTWNwUnVudGltZUVuZHBvaW50OiBtY3BSdW50aW1lU3RhY2suYmlsbGluZ01jcFJ1bnRpbWVFbmRwb2ludCxcbiAgcHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludDogbWNwUnVudGltZVN0YWNrLnByaWNpbmdNY3BSdW50aW1lRW5kcG9pbnQsXG4gIGNsb3Vkd2F0Y2hNY3BSdW50aW1lQXJuOiBtY3BSdW50aW1lU3RhY2suY2xvdWR3YXRjaE1jcFJ1bnRpbWVBcm4sXG4gIGNsb3Vkd2F0Y2hNY3BSdW50aW1lRW5kcG9pbnQ6IG1jcFJ1bnRpbWVTdGFjay5jbG91ZHdhdGNoTWNwUnVudGltZUVuZHBvaW50LFxuICBjbG91ZHRyYWlsTWNwUnVudGltZUFybjogbWNwUnVudGltZVN0YWNrLmNsb3VkdHJhaWxNY3BSdW50aW1lQXJuLFxuICBjbG91ZHRyYWlsTWNwUnVudGltZUVuZHBvaW50OiBtY3BSdW50aW1lU3RhY2suY2xvdWR0cmFpbE1jcFJ1bnRpbWVFbmRwb2ludCxcbiAgaW52ZW50b3J5TWNwUnVudGltZUFybjogbWNwUnVudGltZVN0YWNrLmludmVudG9yeU1jcFJ1bnRpbWVBcm4sXG4gIGludmVudG9yeU1jcFJ1bnRpbWVFbmRwb2ludDogbWNwUnVudGltZVN0YWNrLmludmVudG9yeU1jcFJ1bnRpbWVFbmRwb2ludCxcbiAgLy8gQXV0aFN0YWNrIENvZ25pdG8gZm9yIG91dGJvdW5kIE9BdXRoIHRvIHJ1bnRpbWVzXG4gIGF1dGhVc2VyUG9vbElkOiBhdXRoU3RhY2sudXNlclBvb2xJZCxcbiAgYXV0aFVzZXJQb29sQXJuOiBhdXRoU3RhY2sudXNlclBvb2xBcm4sXG4gIGF1dGhNMm1DbGllbnRJZDogYXV0aFN0YWNrLm9hdXRoQ2xpZW50SWQsXG59KTtcbmFnZW50Q29yZUdhdGV3YXlTdGFjay5hZGREZXBlbmRlbmN5KG1jcFJ1bnRpbWVTdGFjayk7XG5hZ2VudENvcmVHYXRld2F5U3RhY2suYWRkRGVwZW5kZW5jeShhdXRoU3RhY2spO1xuXG4vLyBTdGFjayA1OiBNYWluIFJ1bnRpbWUgU3RhY2sgLSBNYWluIGFnZW50IHJ1bnRpbWUgd2l0aCBHYXRld2F5IEFSTlxuY29uc3QgYWdlbnRSdW50aW1lU3RhY2sgPSBuZXcgQWdlbnRSdW50aW1lU3RhY2soYXBwLCAnQ2xvdWRPcHNBZ2VudFJ1bnRpbWVTdGFjaycsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Nsb3VkT3BzIEFnZW50IC0gTWFpbiBBZ2VudCBSdW50aW1lIHdpdGggR2F0ZXdheSBJbnRlZ3JhdGlvbicsXG4gIHJlcG9zaXRvcnk6IGltYWdlU3RhY2sucmVwb3NpdG9yeSxcbiAgdXNlclBvb2xBcm46IGF1dGhTdGFjay51c2VyUG9vbEFybixcbiAgZ2F0ZXdheUFybjogYWdlbnRDb3JlR2F0ZXdheVN0YWNrLmdhdGV3YXlBcm4sXG4gIHVzZXJQb29sSWQ6IGF1dGhTdGFjay51c2VyUG9vbElkLFxuICB1c2VyUG9vbENsaWVudElkOiBhdXRoU3RhY2sudXNlclBvb2xDbGllbnRJZCxcbiAgaWRlbnRpdHlQb29sSWQ6IGF1dGhTdGFjay5pZGVudGl0eVBvb2xJZCxcbn0pO1xuYWdlbnRSdW50aW1lU3RhY2suYWRkRGVwZW5kZW5jeShpbWFnZVN0YWNrKTtcbmFnZW50UnVudGltZVN0YWNrLmFkZERlcGVuZGVuY3koYXV0aFN0YWNrKTtcbmFnZW50UnVudGltZVN0YWNrLmFkZERlcGVuZGVuY3koYWdlbnRDb3JlR2F0ZXdheVN0YWNrKTtcblxuLy8gU3RhY2sgNjogQ29udmVyc2F0aW9uIEhpc3RvcnkgLSBEeW5hbW9EQiArIEFQSSBHYXRld2F5IGZvciBjb252ZXJzYXRpb24gcGVyc2lzdGVuY2VcbmNvbnN0IGNvbnZlcnNhdGlvbkhpc3RvcnlTdGFjayA9IG5ldyBDb252ZXJzYXRpb25IaXN0b3J5U3RhY2soYXBwLCAnQ2xvdWRPcHNDb252ZXJzYXRpb25IaXN0b3J5U3RhY2snLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdDbG91ZE9wcyBBZ2VudCAtIENvbnZlcnNhdGlvbiBIaXN0b3J5IChEeW5hbW9EQiArIEFQSSBHYXRld2F5KScsXG4gIHVzZXJQb29sQXJuOiBhdXRoU3RhY2sudXNlclBvb2xBcm4sXG4gIHVzZXJQb29sSWQ6IGF1dGhTdGFjay51c2VyUG9vbElkLFxufSk7XG5jb252ZXJzYXRpb25IaXN0b3J5U3RhY2suYWRkRGVwZW5kZW5jeShhdXRoU3RhY2spO1xuXG4vLyBBZGQgdGFncyB0byBhbGwgc3RhY2tzXG5jZGsuVGFncy5vZihhcHApLmFkZCgnUHJvamVjdCcsICdDbG91ZE9wc0FnZW50Jyk7XG5jZGsuVGFncy5vZihhcHApLmFkZCgnTWFuYWdlZEJ5JywgJ0NESycpO1xuIl19