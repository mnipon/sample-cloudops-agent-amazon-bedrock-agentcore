import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
export interface MCPRuntimeStackProps extends cdk.StackProps {
    billingMcpRepository: ecr.IRepository;
    pricingMcpRepository: ecr.IRepository;
    cloudwatchMcpRepository: ecr.IRepository;
    cloudtrailMcpRepository: ecr.IRepository;
    inventoryMcpRepository: ecr.IRepository;
    userPoolId: string;
    m2mClientId: string;
    eolTableName?: string;
}
export declare class MCPRuntimeStack extends cdk.Stack {
    readonly billingMcpRuntimeArn: string;
    readonly pricingMcpRuntimeArn: string;
    readonly cloudwatchMcpRuntimeArn: string;
    readonly cloudtrailMcpRuntimeArn: string;
    readonly inventoryMcpRuntimeArn: string;
    readonly billingMcpRuntimeEndpoint: string;
    readonly pricingMcpRuntimeEndpoint: string;
    readonly cloudwatchMcpRuntimeEndpoint: string;
    readonly cloudtrailMcpRuntimeEndpoint: string;
    readonly inventoryMcpRuntimeEndpoint: string;
    constructor(scope: Construct, id: string, props: MCPRuntimeStackProps);
}
