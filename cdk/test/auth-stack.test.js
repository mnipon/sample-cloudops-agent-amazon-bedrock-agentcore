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
const cdk = __importStar(require("aws-cdk-lib"));
const assertions_1 = require("aws-cdk-lib/assertions");
const auth_stack_1 = require("../lib/auth-stack");
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
    let template;
    beforeAll(() => {
        const app = new cdk.App();
        const stack = new auth_stack_1.AuthStack(app, 'TestAuthStack', {
            env: { account: '123456789012', region: 'us-east-1' },
            adminEmail: 'admin@example.com',
        });
        template = assertions_1.Template.fromStack(stack);
    });
    test('defines the Administrators Cognito group', () => {
        template.hasResourceProperties('AWS::Cognito::UserPoolGroup', {
            GroupName: 'Administrators',
        });
    });
    test('configures a Pre Token Generation (V2_0) Lambda trigger on the User Pool', () => {
        template.hasResourceProperties('AWS::Cognito::UserPool', {
            LambdaConfig: assertions_1.Match.objectLike({
                PreTokenGenerationConfig: assertions_1.Match.objectLike({
                    LambdaArn: assertions_1.Match.anyValue(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1zdGFjay50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0aC1zdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCxrREFBOEM7QUFFOUM7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0gsUUFBUSxDQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUU7SUFDekIsSUFBSSxRQUFrQixDQUFDO0lBRXZCLFNBQVMsQ0FBQyxHQUFHLEVBQUU7UUFDYixNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUMxQixNQUFNLEtBQUssR0FBRyxJQUFJLHNCQUFTLENBQUMsR0FBRyxFQUFFLGVBQWUsRUFBRTtZQUNoRCxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUU7WUFDckQsVUFBVSxFQUFFLG1CQUFtQjtTQUNoQyxDQUFDLENBQUM7UUFDSCxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDdkMsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsMENBQTBDLEVBQUUsR0FBRyxFQUFFO1FBQ3BELFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyw2QkFBNkIsRUFBRTtZQUM1RCxTQUFTLEVBQUUsZ0JBQWdCO1NBQzVCLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLDBFQUEwRSxFQUFFLEdBQUcsRUFBRTtRQUNwRixRQUFRLENBQUMscUJBQXFCLENBQUMsd0JBQXdCLEVBQUU7WUFDdkQsWUFBWSxFQUFFLGtCQUFLLENBQUMsVUFBVSxDQUFDO2dCQUM3Qix3QkFBd0IsRUFBRSxrQkFBSyxDQUFDLFVBQVUsQ0FBQztvQkFDekMsU0FBUyxFQUFFLGtCQUFLLENBQUMsUUFBUSxFQUFFO29CQUMzQixhQUFhLEVBQUUsTUFBTTtpQkFDdEIsQ0FBQzthQUNILENBQUM7U0FDSCxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxrREFBa0QsRUFBRSxHQUFHLEVBQUU7UUFDNUQsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHVCQUF1QixFQUFFO1lBQ3RELE9BQU8sRUFBRSxpQkFBaUI7WUFDMUIsT0FBTyxFQUFFLFlBQVk7U0FDdEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsK0RBQStELEVBQUUsR0FBRyxFQUFFO1FBQ3pFLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyw2Q0FBNkMsRUFBRTtZQUM1RSxTQUFTLEVBQUUsZ0JBQWdCO1NBQzVCLENBQUMsQ0FBQztRQUNILFFBQVEsQ0FBQyxlQUFlLENBQUMsNkNBQTZDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDN0UsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBNYXRjaCwgVGVtcGxhdGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJztcbmltcG9ydCB7IEF1dGhTdGFjayB9IGZyb20gJy4uL2xpYi9hdXRoLXN0YWNrJztcblxuLyoqXG4gKiBDREsgc25hcHNob3QgLyByZWdyZXNzaW9uIHRlc3QgZm9yIEF1dGhTdGFjay5cbiAqXG4gKiBGZWF0dXJlOiBnYXRld2F5LXRvb2wtYWNjZXNzLWNvbnRyb2wgKFJlcXVpcmVtZW50IDEuMSkuXG4gKiBBc3NlcnRzIHRoZSByb2xlLWNsYWltIHBsdW1iaW5nIGFkZGVkIGluIHRhc2sgMy4zIGlzIHByZXNlbnQgaW4gdGhlXG4gKiBzeW50aGVzaXplZCB0ZW1wbGF0ZTpcbiAqICAtIHRoZSBgQWRtaW5pc3RyYXRvcnNgIENvZ25pdG8gZ3JvdXAsIGFuZFxuICogIC0gdGhlIFByZSBUb2tlbiBHZW5lcmF0aW9uIChWMl8wKSBMYW1iZGEgdHJpZ2dlciBvbiB0aGUgVXNlciBQb29sLlxuICpcbiAqIFNlZSBkZXNpZ24ubWQsIFRlc3RpbmcgU3RyYXRlZ3kg4oaSIFwiUmVncmVzc2lvbiAvIHNuYXBzaG90IHRlc3RzIChJYUMpXCI6XG4gKiBcIlNuYXBzaG90IG9mIHRoZSBBdXRoU3RhY2sgYXNzZXJ0cyB0aGUgYEFkbWluaXN0cmF0b3JzYCBncm91cCBhbmQgdGhlXG4gKiAgUHJlIFRva2VuIEdlbmVyYXRpb24gTGFtYmRhIHRyaWdnZXIgYXJlIHByZXNlbnQuXCJcbiAqL1xuZGVzY3JpYmUoJ0F1dGhTdGFjaycsICgpID0+IHtcbiAgbGV0IHRlbXBsYXRlOiBUZW1wbGF0ZTtcblxuICBiZWZvcmVBbGwoKCkgPT4ge1xuICAgIGNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG4gICAgY29uc3Qgc3RhY2sgPSBuZXcgQXV0aFN0YWNrKGFwcCwgJ1Rlc3RBdXRoU3RhY2snLCB7XG4gICAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfSxcbiAgICAgIGFkbWluRW1haWw6ICdhZG1pbkBleGFtcGxlLmNvbScsXG4gICAgfSk7XG4gICAgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICB9KTtcblxuICB0ZXN0KCdkZWZpbmVzIHRoZSBBZG1pbmlzdHJhdG9ycyBDb2duaXRvIGdyb3VwJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDb2duaXRvOjpVc2VyUG9vbEdyb3VwJywge1xuICAgICAgR3JvdXBOYW1lOiAnQWRtaW5pc3RyYXRvcnMnLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdjb25maWd1cmVzIGEgUHJlIFRva2VuIEdlbmVyYXRpb24gKFYyXzApIExhbWJkYSB0cmlnZ2VyIG9uIHRoZSBVc2VyIFBvb2wnLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNvZ25pdG86OlVzZXJQb29sJywge1xuICAgICAgTGFtYmRhQ29uZmlnOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgUHJlVG9rZW5HZW5lcmF0aW9uQ29uZmlnOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBMYW1iZGFBcm46IE1hdGNoLmFueVZhbHVlKCksXG4gICAgICAgICAgTGFtYmRhVmVyc2lvbjogJ1YyXzAnLFxuICAgICAgICB9KSxcbiAgICAgIH0pLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdjcmVhdGVzIHRoZSBQcmUgVG9rZW4gR2VuZXJhdGlvbiBMYW1iZGEgZnVuY3Rpb24nLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICBIYW5kbGVyOiAnaGFuZGxlci5oYW5kbGVyJyxcbiAgICAgIFJ1bnRpbWU6ICdweXRob24zLjEyJyxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnYXR0YWNoZXMgdGhlIGJvb3RzdHJhcCBhZG1pbiB1c2VyIHRvIHRoZSBBZG1pbmlzdHJhdG9ycyBncm91cCcsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2xVc2VyVG9Hcm91cEF0dGFjaG1lbnQnLCB7XG4gICAgICBHcm91cE5hbWU6ICdBZG1pbmlzdHJhdG9ycycsXG4gICAgfSk7XG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkNvZ25pdG86OlVzZXJQb29sVXNlclRvR3JvdXBBdHRhY2htZW50JywgMSk7XG4gIH0pO1xufSk7XG4iXX0=