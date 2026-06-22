import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack';

/**
 * CDK snapshot / regression test for AuthStack.
 *
 * Feature: gateway-tool-access-control (Requirement 1.1).
 * Asserts the role-claim plumbing added in task 3.3 is present in the
 * synthesized template:
 *  - the `Administrators` Cognito group, and
 *  - the Pre Token Generation (V2_0) Lambda trigger on the User Pool.
 *
 * See design.md, Testing Strategy → "Regression / snapshot tests (IaC)":
 * "Snapshot of the AuthStack asserts the `Administrators` group and the
 *  Pre Token Generation Lambda trigger are present."
 */
describe('AuthStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new AuthStack(app, 'TestAuthStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      adminEmail: 'admin@example.com',
    });
    template = Template.fromStack(stack);
  });

  test('defines the Administrators Cognito group', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', {
      GroupName: 'Administrators',
    });
  });

  test('configures a Pre Token Generation (V2_0) Lambda trigger on the User Pool', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        PreTokenGenerationConfig: Match.objectLike({
          LambdaArn: Match.anyValue(),
          LambdaVersion: 'V2_0',
        }),
      }),
    });
  });

  test('creates the Pre Token Generation Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'handler.handler',
      Runtime: 'python3.12',
    });
  });

  test('attaches the bootstrap admin user to the Administrators group', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolUserToGroupAttachment', {
      GroupName: 'Administrators',
    });
    template.resourceCountIs('AWS::Cognito::UserPoolUserToGroupAttachment', 1);
  });
});
