import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
export interface ConversationHistoryStackProps extends cdk.StackProps {
    userPoolArn: string;
    userPoolId: string;
    userPoolClientId: string;
    identityPoolId: string;
    agentRuntimeArn: string;
}
export declare class ConversationHistoryStack extends cdk.Stack {
    readonly conversationHandler: lambda.Function;
    readonly api: apigateway.RestApi;
    constructor(scope: Construct, id: string, props: ConversationHistoryStackProps);
}
