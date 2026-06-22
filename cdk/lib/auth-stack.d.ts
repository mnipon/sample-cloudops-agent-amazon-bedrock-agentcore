import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface AuthStackProps extends cdk.StackProps {
    adminEmail: string;
}
export declare class AuthStack extends cdk.Stack {
    readonly userPoolId: string;
    readonly userPoolClientId: string;
    readonly identityPoolId: string;
    readonly userPoolArn: string;
    readonly userPoolProviderName: string;
    readonly oauthClientId: string;
    readonly oauthTokenEndpoint: string;
    readonly oauthAuthorizationEndpoint: string;
    readonly oauthIssuer: string;
    readonly oauthProviderName: string;
    readonly oauthProviderArn: string;
    /** Name of the Cognito group whose members resolve to the Admin role. */
    readonly adminGroupName: string;
    /** Name of the scalar role claim injected into the issued tokens. */
    readonly roleClaimName: string;
    constructor(scope: Construct, id: string, props: AuthStackProps);
}
