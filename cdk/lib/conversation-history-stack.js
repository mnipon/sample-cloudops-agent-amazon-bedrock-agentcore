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
exports.ConversationHistoryStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const path = __importStar(require("path"));
const cdk_nag_1 = require("cdk-nag");
class ConversationHistoryStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========================================
        // DynamoDB Table — Conversations
        // ========================================
        const conversationsTable = new dynamodb.Table(this, 'CloudOpsConversationsTable', {
            tableName: `${this.stackName}-conversations`,
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'conversationId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // ========================================
        // Lambda Function — Conversation Handler
        // ========================================
        this.conversationHandler = new lambda.Function(this, 'ConversationHandler', {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'handler.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/conversations')),
            memorySize: 256,
            timeout: cdk.Duration.seconds(30),
            description: 'Handles CRUD operations for conversation history',
            environment: {
                TABLE_NAME: conversationsTable.tableName,
            },
        });
        // Grant Lambda read/write access to the DynamoDB table
        conversationsTable.grantReadWriteData(this.conversationHandler);
        // ========================================
        // Cognito User Pool (existing) — Lookup
        // ========================================
        const userPool = cognito.UserPool.fromUserPoolArn(this, 'UserPool', props.userPoolArn);
        // ========================================
        // API Gateway REST API — Conversation API
        // ========================================
        this.api = new apigateway.RestApi(this, 'ConversationApi', {
            restApiName: 'ConversationApi',
            description: 'REST API for conversation history CRUD operations',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                allowHeaders: ['Content-Type', 'Authorization'],
            },
            deployOptions: {
                stageName: 'prod',
            },
        });
        // ========================================
        // Cognito Authorizer
        // ========================================
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ConversationAuthorizer', {
            cognitoUserPools: [userPool],
        });
        // Lambda integration for API methods
        const lambdaIntegration = new apigateway.LambdaIntegration(this.conversationHandler);
        // ========================================
        // API Resources and Methods
        // ========================================
        // /conversations resource
        const conversationsResource = this.api.root.addResource('conversations');
        conversationsResource.addMethod('GET', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        conversationsResource.addMethod('POST', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // /conversations/{conversationId} resource
        const conversationByIdResource = conversationsResource.addResource('{conversationId}');
        conversationByIdResource.addMethod('GET', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        conversationByIdResource.addMethod('PUT', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        conversationByIdResource.addMethod('DELETE', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // ========================================
        // Outputs
        // ========================================
        new cdk.CfnOutput(this, 'ConversationApiUrl', {
            value: this.api.url,
            description: 'Conversation API endpoint URL',
            exportName: `${this.stackName}-ConversationApiUrl`,
        });
        // Echo the other FrontEnd-relevant values here too, so an admin can read
        // EVERYTHING the FrontEnd needs from this one (last-deployed) stack's
        // outputs instead of hunting across AuthStack + AgentRuntimeStack.
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: props.userPoolId,
            description: 'Cognito User Pool ID (FrontEnd appConfig: cognito.userPoolId)',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: props.userPoolClientId,
            description: 'Cognito User Pool Client ID (FrontEnd appConfig: cognito.userPoolClientId)',
        });
        new cdk.CfnOutput(this, 'IdentityPoolId', {
            value: props.identityPoolId,
            description: 'Cognito Identity Pool ID (FrontEnd appConfig: cognito.identityPoolId)',
        });
        new cdk.CfnOutput(this, 'AgentCoreArn', {
            value: props.agentRuntimeArn,
            description: 'AgentCore Runtime ARN (FrontEnd appConfig: agentcore.agentArn)',
        });
        // Single copy-paste-ready FrontEnd configuration. This is the exact JSON
        // shape the SPA reads from localStorage("appConfig"), assembled from every
        // stack so the admin can configure the FrontEnd in one step. Tokens
        // (User Pool ID, client ID, identity pool, agent ARN, API URL) are resolved
        // by CloudFormation at deploy time.
        const frontEndConfig = {
            cognito: {
                userPoolId: props.userPoolId,
                userPoolClientId: props.userPoolClientId,
                identityPoolId: props.identityPoolId,
                region: this.region,
            },
            agentcore: {
                enabled: true,
                region: this.region,
                agentArn: props.agentRuntimeArn,
            },
            conversationApi: {
                endpoint: this.api.url,
            },
        };
        new cdk.CfnOutput(this, 'FrontEndConfig', {
            value: JSON.stringify(frontEndConfig),
            description: 'Copy-paste this JSON into the FrontEnd localStorage key "appConfig"',
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.conversationHandler, [
            { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.' },
            { id: 'AwsSolutions-IAM5', reason: 'DynamoDB read/write permissions use wildcards for index operations.' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.api, [
            { id: 'AwsSolutions-APIG2', reason: 'Request validation handled by Lambda handler logic.' },
            { id: 'AwsSolutions-APIG4', reason: 'All methods use Cognito authorizer except OPTIONS (CORS preflight).' },
            { id: 'AwsSolutions-COG4', reason: 'OPTIONS methods do not require Cognito auth for CORS preflight.' },
            { id: 'AwsSolutions-APIG1', reason: 'Access logging not enabled for dev/demo deployment.' },
            { id: 'AwsSolutions-APIG3', reason: 'WAF not associated for dev/demo deployment.' },
            { id: 'AwsSolutions-APIG6', reason: 'CloudWatch logging not enabled for dev/demo deployment.' },
            { id: 'AwsSolutions-IAM4', reason: 'API Gateway CloudWatch role uses AWS managed policy.' },
        ], true);
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            { id: 'AwsSolutions-L1', reason: 'Python 3.12 runtime is intentionally pinned for stability.' },
        ]);
    }
}
exports.ConversationHistoryStack = ConversationHistoryStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udmVyc2F0aW9uLWhpc3Rvcnktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb252ZXJzYXRpb24taGlzdG9yeS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsbUVBQXFEO0FBQ3JELCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQsaUVBQW1EO0FBRW5ELDJDQUE2QjtBQUM3QixxQ0FBMEM7QUFhMUMsTUFBYSx3QkFBeUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUlyRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9DO1FBQzVFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDJDQUEyQztRQUMzQyxpQ0FBaUM7UUFDakMsMkNBQTJDO1FBQzNDLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSw0QkFBNEIsRUFBRTtZQUNoRixTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxnQkFBZ0I7WUFDNUMsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDckUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLGdCQUFnQixFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUN4RSxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsMkNBQTJDO1FBQzNDLHlDQUF5QztRQUN6QywyQ0FBMkM7UUFDM0MsSUFBSSxDQUFDLG1CQUFtQixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVB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cUQsRUFBRTtZQUMzRixFQUFFLEVBQUUsRUFBRSxvQkFBb0IsRUFBRSxNQUFNLEVBQUUscUVBQXFFLEVBQUU7WUFDM0csRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLGlFQUFpRSxFQUFFO1lBQ3RHLEVBQUUsRUFBRSxFQUFFLG9CQUFvQixFQUFFLE1BQU0sRUFBRSxxREFBcUQsRUFBRTtZQUMzRixFQUFFLEVBQUUsRUFBRSxvQkFBb0IsRUFBRSxNQUFNLEVBQUUsNkNBQTZDLEVBQUU7WUFDbkYsRUFBRSxFQUFFLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSxFQUFFLHlEQUF5RCxFQUFFO1lBQy9GLEVBQUUsRUFBRSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSxzREFBc0QsRUFBRTtTQUM1RixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQseUJBQWUsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUU7WUFDekMsRUFBRSxFQUFFLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxFQUFFLDREQUE0RCxFQUFFO1NBQ2hHLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTlLRCw0REE4S0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcblxuZXhwb3J0IGludGVyZmFjZSBDb252ZXJzYXRpb25IaXN0b3J5U3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdXNlclBvb2xBcm46IHN0cmluZztcbiAgdXNlclBvb2xJZDogc3RyaW5nO1xuICAvLyBUaGUgcmVtYWluaW5nIHZhbHVlcyB0aGUgRnJvbnRFbmQgYGFwcENvbmZpZ2AgbmVlZHMsIHBhc3NlZCBpbiBzbyB0aGlzXG4gIC8vIChsYXN0LWRlcGxveWVkKSBzdGFjayBjYW4gZW1pdCBhIHNpbmdsZSBjb25zb2xpZGF0ZWQgRnJvbnRFbmQgY29uZmlnIG91dHB1dFxuICAvLyBhbG9uZ3NpZGUgdGhlIENvbnZlcnNhdGlvbiBBUEkgVVJMIGl0IG93bnMuXG4gIHVzZXJQb29sQ2xpZW50SWQ6IHN0cmluZztcbiAgaWRlbnRpdHlQb29sSWQ6IHN0cmluZztcbiAgYWdlbnRSdW50aW1lQXJuOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDb252ZXJzYXRpb25IaXN0b3J5U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgY29udmVyc2F0aW9uSGFuZGxlcjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IENvbnZlcnNhdGlvbkhpc3RvcnlTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRHluYW1vREIgVGFibGUg4oCUIENvbnZlcnNhdGlvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgY29udmVyc2F0aW9uc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDbG91ZE9wc0NvbnZlcnNhdGlvbnNUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7dGhpcy5zdGFja05hbWV9LWNvbnZlcnNhdGlvbnNgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1c2VySWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY29udmVyc2F0aW9uSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTGFtYmRhIEZ1bmN0aW9uIOKAlCBDb252ZXJzYXRpb24gSGFuZGxlclxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLmNvbnZlcnNhdGlvbkhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdDb252ZXJzYXRpb25IYW5kbGVyJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTIsXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlci5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL2NvbnZlcnNhdGlvbnMnKSksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBkZXNjcmlwdGlvbjogJ0hhbmRsZXMgQ1JVRCBvcGVyYXRpb25zIGZvciBjb252ZXJzYXRpb24gaGlzdG9yeScsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBUQUJMRV9OQU1FOiBjb252ZXJzYXRpb25zVGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IExhbWJkYSByZWFkL3dyaXRlIGFjY2VzcyB0byB0aGUgRHluYW1vREIgdGFibGVcbiAgICBjb252ZXJzYXRpb25zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHRoaXMuY29udmVyc2F0aW9uSGFuZGxlcik7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ29nbml0byBVc2VyIFBvb2wgKGV4aXN0aW5nKSDigJQgTG9va3VwXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHVzZXJQb29sID0gY29nbml0by5Vc2VyUG9vbC5mcm9tVXNlclBvb2xBcm4odGhpcywgJ1VzZXJQb29sJywgcHJvcHMudXNlclBvb2xBcm4pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFQSSBHYXRld2F5IFJFU1QgQVBJIOKAlCBDb252ZXJzYXRpb24gQVBJXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMuYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQ29udmVyc2F0aW9uQXBpJywge1xuICAgICAgcmVzdEFwaU5hbWU6ICdDb252ZXJzYXRpb25BcGknLFxuICAgICAgZGVzY3JpcHRpb246ICdSRVNUIEFQSSBmb3IgY29udmVyc2F0aW9uIGhpc3RvcnkgQ1JVRCBvcGVyYXRpb25zJyxcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUyxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdQT1NUJywgJ1BVVCcsICdERUxFVEUnLCAnT1BUSU9OUyddLFxuICAgICAgICBhbGxvd0hlYWRlcnM6IFsnQ29udGVudC1UeXBlJywgJ0F1dGhvcml6YXRpb24nXSxcbiAgICAgIH0sXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDb2duaXRvIEF1dGhvcml6ZXJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgYXV0aG9yaXplciA9IG5ldyBhcGlnYXRld2F5LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsICdDb252ZXJzYXRpb25BdXRob3JpemVyJywge1xuICAgICAgY29nbml0b1VzZXJQb29sczogW3VzZXJQb29sXSxcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYSBpbnRlZ3JhdGlvbiBmb3IgQVBJIG1ldGhvZHNcbiAgICBjb25zdCBsYW1iZGFJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHRoaXMuY29udmVyc2F0aW9uSGFuZGxlcik7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQVBJIFJlc291cmNlcyBhbmQgTWV0aG9kc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIC9jb252ZXJzYXRpb25zIHJlc291cmNlXG4gICAgY29uc3QgY29udmVyc2F0aW9uc1Jlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZSgnY29udmVyc2F0aW9ucycpO1xuICAgIGNvbnZlcnNhdGlvbnNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyxcbiAgICB9KTtcbiAgICBjb252ZXJzYXRpb25zUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxuICAgIH0pO1xuXG4gICAgLy8gL2NvbnZlcnNhdGlvbnMve2NvbnZlcnNhdGlvbklkfSByZXNvdXJjZVxuICAgIGNvbnN0IGNvbnZlcnNhdGlvbkJ5SWRSZXNvdXJjZSA9IGNvbnZlcnNhdGlvbnNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2NvbnZlcnNhdGlvbklkfScpO1xuICAgIGNvbnZlcnNhdGlvbkJ5SWRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyxcbiAgICB9KTtcbiAgICBjb252ZXJzYXRpb25CeUlkUmVzb3VyY2UuYWRkTWV0aG9kKCdQVVQnLCBsYW1iZGFJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG4gICAgY29udmVyc2F0aW9uQnlJZFJlc291cmNlLmFkZE1ldGhvZCgnREVMRVRFJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvbnZlcnNhdGlvbkFwaVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnNhdGlvbiBBUEkgZW5kcG9pbnQgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1Db252ZXJzYXRpb25BcGlVcmxgLFxuICAgIH0pO1xuXG4gICAgLy8gRWNobyB0aGUgb3RoZXIgRnJvbnRFbmQtcmVsZXZhbnQgdmFsdWVzIGhlcmUgdG9vLCBzbyBhbiBhZG1pbiBjYW4gcmVhZFxuICAgIC8vIEVWRVJZVEhJTkcgdGhlIEZyb250RW5kIG5lZWRzIGZyb20gdGhpcyBvbmUgKGxhc3QtZGVwbG95ZWQpIHN0YWNrJ3NcbiAgICAvLyBvdXRwdXRzIGluc3RlYWQgb2YgaHVudGluZyBhY3Jvc3MgQXV0aFN0YWNrICsgQWdlbnRSdW50aW1lU3RhY2suXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogcHJvcHMudXNlclBvb2xJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgSUQgKEZyb250RW5kIGFwcENvbmZpZzogY29nbml0by51c2VyUG9vbElkKScsXG4gICAgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7XG4gICAgICB2YWx1ZTogcHJvcHMudXNlclBvb2xDbGllbnRJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEIChGcm9udEVuZCBhcHBDb25maWc6IGNvZ25pdG8udXNlclBvb2xDbGllbnRJZCknLFxuICAgIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJZGVudGl0eVBvb2xJZCcsIHtcbiAgICAgIHZhbHVlOiBwcm9wcy5pZGVudGl0eVBvb2xJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBJZGVudGl0eSBQb29sIElEIChGcm9udEVuZCBhcHBDb25maWc6IGNvZ25pdG8uaWRlbnRpdHlQb29sSWQpJyxcbiAgICB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWdlbnRDb3JlQXJuJywge1xuICAgICAgdmFsdWU6IHByb3BzLmFnZW50UnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWdlbnRDb3JlIFJ1bnRpbWUgQVJOIChGcm9udEVuZCBhcHBDb25maWc6IGFnZW50Y29yZS5hZ2VudEFybiknLFxuICAgIH0pO1xuXG4gICAgLy8gU2luZ2xlIGNvcHktcGFzdGUtcmVhZHkgRnJvbnRFbmQgY29uZmlndXJhdGlvbi4gVGhpcyBpcyB0aGUgZXhhY3QgSlNPTlxuICAgIC8vIHNoYXBlIHRoZSBTUEEgcmVhZHMgZnJvbSBsb2NhbFN0b3JhZ2UoXCJhcHBDb25maWdcIiksIGFzc2VtYmxlZCBmcm9tIGV2ZXJ5XG4gICAgLy8gc3RhY2sgc28gdGhlIGFkbWluIGNhbiBjb25maWd1cmUgdGhlIEZyb250RW5kIGluIG9uZSBzdGVwLiBUb2tlbnNcbiAgICAvLyAoVXNlciBQb29sIElELCBjbGllbnQgSUQsIGlkZW50aXR5IHBvb2wsIGFnZW50IEFSTiwgQVBJIFVSTCkgYXJlIHJlc29sdmVkXG4gICAgLy8gYnkgQ2xvdWRGb3JtYXRpb24gYXQgZGVwbG95IHRpbWUuXG4gICAgY29uc3QgZnJvbnRFbmRDb25maWcgPSB7XG4gICAgICBjb2duaXRvOiB7XG4gICAgICAgIHVzZXJQb29sSWQ6IHByb3BzLnVzZXJQb29sSWQsXG4gICAgICAgIHVzZXJQb29sQ2xpZW50SWQ6IHByb3BzLnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgIGlkZW50aXR5UG9vbElkOiBwcm9wcy5pZGVudGl0eVBvb2xJZCxcbiAgICAgICAgcmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgIH0sXG4gICAgICBhZ2VudGNvcmU6IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgYWdlbnRBcm46IHByb3BzLmFnZW50UnVudGltZUFybixcbiAgICAgIH0sXG4gICAgICBjb252ZXJzYXRpb25BcGk6IHtcbiAgICAgICAgZW5kcG9pbnQ6IHRoaXMuYXBpLnVybCxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRnJvbnRFbmRDb25maWcnLCB7XG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoZnJvbnRFbmRDb25maWcpLFxuICAgICAgZGVzY3JpcHRpb246ICdDb3B5LXBhc3RlIHRoaXMgSlNPTiBpbnRvIHRoZSBGcm9udEVuZCBsb2NhbFN0b3JhZ2Uga2V5IFwiYXBwQ29uZmlnXCInLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENESy1OYWcgU3VwcHJlc3Npb25zXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh0aGlzLmNvbnZlcnNhdGlvbkhhbmRsZXIsIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsIHJlYXNvbjogJ0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBpcyBBV1MgYmVzdCBwcmFjdGljZS4nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLCByZWFzb246ICdEeW5hbW9EQiByZWFkL3dyaXRlIHBlcm1pc3Npb25zIHVzZSB3aWxkY2FyZHMgZm9yIGluZGV4IG9wZXJhdGlvbnMuJyB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHRoaXMuYXBpLCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUFQSUcyJywgcmVhc29uOiAnUmVxdWVzdCB2YWxpZGF0aW9uIGhhbmRsZWQgYnkgTGFtYmRhIGhhbmRsZXIgbG9naWMuJyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1BUElHNCcsIHJlYXNvbjogJ0FsbCBtZXRob2RzIHVzZSBDb2duaXRvIGF1dGhvcml6ZXIgZXhjZXB0IE9QVElPTlMgKENPUlMgcHJlZmxpZ2h0KS4nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUNPRzQnLCByZWFzb246ICdPUFRJT05TIG1ldGhvZHMgZG8gbm90IHJlcXVpcmUgQ29nbml0byBhdXRoIGZvciBDT1JTIHByZWZsaWdodC4nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUFQSUcxJywgcmVhc29uOiAnQWNjZXNzIGxvZ2dpbmcgbm90IGVuYWJsZWQgZm9yIGRldi9kZW1vIGRlcGxveW1lbnQuJyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1BUElHMycsIHJlYXNvbjogJ1dBRiBub3QgYXNzb2NpYXRlZCBmb3IgZGV2L2RlbW8gZGVwbG95bWVudC4nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUFQSUc2JywgcmVhc29uOiAnQ2xvdWRXYXRjaCBsb2dnaW5nIG5vdCBlbmFibGVkIGZvciBkZXYvZGVtbyBkZXBsb3ltZW50LicgfSxcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsIHJlYXNvbjogJ0FQSSBHYXRld2F5IENsb3VkV2F0Y2ggcm9sZSB1c2VzIEFXUyBtYW5hZ2VkIHBvbGljeS4nIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkU3RhY2tTdXBwcmVzc2lvbnModGhpcywgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1MMScsIHJlYXNvbjogJ1B5dGhvbiAzLjEyIHJ1bnRpbWUgaXMgaW50ZW50aW9uYWxseSBwaW5uZWQgZm9yIHN0YWJpbGl0eS4nIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==