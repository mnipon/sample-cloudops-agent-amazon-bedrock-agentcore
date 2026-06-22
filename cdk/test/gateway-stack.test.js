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
const gateway_stack_1 = require("../lib/gateway-stack");
/**
 * CDK snapshot / regression test for AgentCoreGatewayStack.
 *
 * Feature: gateway-tool-access-control (Requirements 1.5, 6.2, 6.3).
 * See design.md, Testing Strategy -> "Regression / snapshot tests (IaC)":
 * the GatewayStack snapshot asserts the Gateway uses CUSTOM_JWT inbound
 * authorization (Cognito discovery URL + AllowedClients) and that the Cedar
 * policy set carries exactly the two `permit` statements (billing/pricing for
 * all authenticated users; cloudwatch/cloudtrail/inventory for admins only),
 * with every other category denied by omission (default-deny).
 *
 * The gateway ARN is a CloudFormation intrinsic (Fn::GetAtt) embedded inside
 * the Cedar statement strings, so the statements render as `Fn::Join`
 * structures. We assert on the stable literal substrings of each statement
 * (`tool_category == "billing"`, `getTag("role") == "admin"`, ...) rather than
 * the full ARN.
 */
describe('AgentCoreGatewayStack', () => {
    const FRONTEND_CLIENT_ID = 'dummy-frontend-client-id';
    let template;
    beforeAll(() => {
        const app = new cdk.App();
        const stack = new gateway_stack_1.AgentCoreGatewayStack(app, 'TestGatewayStack', {
            env: { account: '123456789012', region: 'us-east-1' },
            billingMcpRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/billing',
            billingMcpRuntimeEndpoint: 'https://billing.example.com/mcp',
            pricingMcpRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/pricing',
            pricingMcpRuntimeEndpoint: 'https://pricing.example.com/mcp',
            cloudwatchMcpRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/cloudwatch',
            cloudwatchMcpRuntimeEndpoint: 'https://cloudwatch.example.com/mcp',
            cloudtrailMcpRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/cloudtrail',
            cloudtrailMcpRuntimeEndpoint: 'https://cloudtrail.example.com/mcp',
            inventoryMcpRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/inventory',
            inventoryMcpRuntimeEndpoint: 'https://inventory.example.com/mcp',
            authUserPoolId: 'us-east-1_DUMMYPOOL',
            authUserPoolArn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_DUMMYPOOL',
            authM2mClientId: 'dummy-m2m-client-id',
            authUserPoolClientId: FRONTEND_CLIENT_ID,
        });
        template = assertions_1.Template.fromStack(stack);
    });
    /**
     * Recursively collect every string literal from a value. CloudFormation
     * intrinsics (Fn::Join / Fn::GetAtt) are plain objects/arrays, so this
     * flattens an Fn::Join'd Cedar statement back into its literal fragments.
     */
    function collectStrings(node) {
        if (typeof node === 'string') {
            return [node];
        }
        if (Array.isArray(node)) {
            return node.flatMap(collectStrings);
        }
        if (node && typeof node === 'object') {
            return Object.values(node).flatMap(collectStrings);
        }
        return [];
    }
    test('Gateway uses CUSTOM_JWT inbound authorization (Req 1.5)', () => {
        template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
            AuthorizerType: 'CUSTOM_JWT',
        });
    });
    test('CUSTOM_JWT authorizer points at the Cognito discovery URL and allows the frontend client (Req 1.5)', () => {
        template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
            AuthorizerConfiguration: assertions_1.Match.objectLike({
                CustomJWTAuthorizer: assertions_1.Match.objectLike({
                    DiscoveryUrl: assertions_1.Match.stringLikeRegexp('.*\\.well-known/openid-configuration$'),
                    // Cognito access tokens match on client_id (AllowedClients), not aud.
                    AllowedClients: assertions_1.Match.arrayWith([FRONTEND_CLIENT_ID]),
                }),
            }),
        });
    });
    test('Gateway associates the Cedar Policy Engine in ENFORCE mode', () => {
        template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
            PolicyEngineConfiguration: assertions_1.Match.objectLike({
                Mode: 'ENFORCE',
            }),
        });
    });
    test('Gateway registers a REQUEST interceptor (deny-audit)', () => {
        template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
            InterceptorConfigurations: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    InterceptionPoints: assertions_1.Match.arrayWith(['REQUEST']),
                }),
            ]),
        });
    });
    describe('Cedar policy set (Req 6.2, 6.3 — default-deny by omission)', () => {
        // Locate the custom resource that carries the Cedar policy statements.
        function getPolicyStatements() {
            const customResources = template.findResources('AWS::CloudFormation::CustomResource');
            const policyResources = Object.values(customResources).filter((r) => r.Properties && r.Properties.Operation === 'POLICIES');
            expect(policyResources).toHaveLength(1);
            const statements = policyResources[0].Properties.Statements;
            expect(Array.isArray(statements)).toBe(true);
            return statements;
        }
        test('exactly two permit statements are present', () => {
            const statements = getPolicyStatements();
            expect(statements).toHaveLength(2);
            // Every Cedar statement in the set is a `permit` (no `forbid`/deny rules),
            // and there are exactly two of them across the whole policy set.
            const allText = collectStrings(statements).join('\n');
            const permitCount = (allText.match(/permit\(/g) || []).length;
            expect(permitCount).toBe(2);
            expect(allText).not.toContain('forbid(');
        });
        test('billing/pricing permit applies to all users and references no other target group', () => {
            const statements = getPolicyStatements();
            const allUsers = statements.find((s) => s.Name === 'allow_billing_pricing_all_users');
            expect(allUsers).toBeDefined();
            const text = collectStrings(allUsers.Statement).join('\n');
            // Scoped to the billing/pricing target action groups (no per-tool enum).
            expect(text).toContain('AgentCore::Action::"billingMcp"');
            expect(text).toContain('AgentCore::Action::"pricingMcp"');
            // Not gated on the admin role tag, and never grants an ops category.
            expect(text).not.toContain('getTag("role")');
            expect(text).not.toContain('cloudwatchMcp');
            expect(text).not.toContain('cloudtrailMcp');
            expect(text).not.toContain('inventoryMcp');
        });
        test('cloudwatch/cloudtrail/inventory permit is admin-only and references no all-user target group', () => {
            const statements = getPolicyStatements();
            const adminOnly = statements.find((s) => s.Name === 'allow_ops_categories_admin_only');
            expect(adminOnly).toBeDefined();
            const text = collectStrings(adminOnly.Statement).join('\n');
            // Guarded on the verified JWT role claim (stored as a principal tag).
            expect(text).toContain('getTag("role") == "admin"');
            expect(text).toContain('AgentCore::Action::"cloudwatchMcp"');
            expect(text).toContain('AgentCore::Action::"cloudtrailMcp"');
            expect(text).toContain('AgentCore::Action::"inventoryMcp"');
            // The admin permit must not silently widen billing/pricing access.
            expect(text).not.toContain('AgentCore::Action::"billingMcp"');
            expect(text).not.toContain('AgentCore::Action::"pricingMcp"');
        });
        test('no permit exists for any target group outside the documented five (default-deny)', () => {
            const statements = getPolicyStatements();
            const allText = collectStrings(statements).join('\n');
            // Collect every target action group referenced anywhere in the policy set.
            const referenced = new Set(Array.from(allText.matchAll(/AgentCore::Action::"([^"]+)"/g)).map((m) => m[1]));
            const allowed = new Set([
                'billingMcp',
                'pricingMcp',
                'cloudwatchMcp',
                'cloudtrailMcp',
                'inventoryMcp',
            ]);
            for (const target of referenced) {
                expect(allowed.has(target)).toBe(true);
            }
            // All five known target groups are accounted for; anything else (incl.
            // future targets) is denied by omission for non-admins.
            expect(referenced).toEqual(allowed);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2F0ZXdheS1zdGFjay50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZ2F0ZXdheS1zdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCx3REFBNkQ7QUFFN0Q7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7QUFDSCxRQUFRLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFO0lBQ3JDLE1BQU0sa0JBQWtCLEdBQUcsMEJBQTBCLENBQUM7SUFDdEQsSUFBSSxRQUFrQixDQUFDO0lBRXZCLFNBQVMsQ0FBQyxHQUFHLEVBQUU7UUFDYixNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUMxQixNQUFNLEtBQUssR0FBRyxJQUFJLHFDQUFxQixDQUFDLEdBQUcsRUFBRSxrQkFBa0IsRUFBRTtZQUMvRCxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUU7WUFDckQsb0JBQW9CLEVBQUUsa0VBQWtFO1lBQ3hGLHlCQUF5QixFQUFFLGlDQUFpQztZQUM1RCxvQkFBb0IsRUFBRSxrRUFBa0U7WUFDeEYseUJBQXlCLEVBQUUsaUNBQWlDO1lBQzVELHVCQUF1QixFQUFFLHFFQUFxRTtZQUM5Riw0QkFBNEIsRUFBRSxvQ0FBb0M7WUFDbEUsdUJBQXVCLEVBQUUscUVBQXFFO1lBQzlGLDRCQUE0QixFQUFFLG9DQUFvQztZQUNsRSxzQkFBc0IsRUFBRSxvRUFBb0U7WUFDNUYsMkJBQTJCLEVBQUUsbUNBQW1DO1lBQ2hFLGNBQWMsRUFBRSxxQkFBcUI7WUFDckMsZUFBZSxFQUFFLHlFQUF5RTtZQUMxRixlQUFlLEVBQUUscUJBQXFCO1lBQ3RDLG9CQUFvQixFQUFFLGtCQUFrQjtTQUN6QyxDQUFDLENBQUM7UUFDSCxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFT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bnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IE1hdGNoLCBUZW1wbGF0ZSB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgQWdlbnRDb3JlR2F0ZXdheVN0YWNrIH0gZnJvbSAnLi4vbGliL2dhdGV3YXktc3RhY2snO1xuXG4vKipcbiAqIENESyBzbmFwc2hvdCAvIHJlZ3Jlc3Npb24gdGVzdCBmb3IgQWdlbnRDb3JlR2F0ZXdheVN0YWNrLlxuICpcbiAqIEZlYXR1cmU6IGdhdGV3YXktdG9vbC1hY2Nlc3MtY29udHJvbCAoUmVxdWlyZW1lbnRzIDEuNSwgNi4yLCA2LjMpLlxuICogU2VlIGRlc2lnbi5tZCwgVGVzdGluZyBTdHJhdGVneSAtPiBcIlJlZ3Jlc3Npb24gLyBzbmFwc2hvdCB0ZXN0cyAoSWFDKVwiOlxuICogdGhlIEdhdGV3YXlTdGFjayBzbmFwc2hvdCBhc3NlcnRzIHRoZSBHYXRld2F5IHVzZXMgQ1VTVE9NX0pXVCBpbmJvdW5kXG4gKiBhdXRob3JpemF0aW9uIChDb2duaXRvIGRpc2NvdmVyeSBVUkwgKyBBbGxvd2VkQ2xpZW50cykgYW5kIHRoYXQgdGhlIENlZGFyXG4gKiBwb2xpY3kgc2V0IGNhcnJpZXMgZXhhY3RseSB0aGUgdHdvIGBwZXJtaXRgIHN0YXRlbWVudHMgKGJpbGxpbmcvcHJpY2luZyBmb3JcbiAqIGFsbCBhdXRoZW50aWNhdGVkIHVzZXJzOyBjbG91ZHdhdGNoL2Nsb3VkdHJhaWwvaW52ZW50b3J5IGZvciBhZG1pbnMgb25seSksXG4gKiB3aXRoIGV2ZXJ5IG90aGVyIGNhdGVnb3J5IGRlbmllZCBieSBvbWlzc2lvbiAoZGVmYXVsdC1kZW55KS5cbiAqXG4gKiBUaGUgZ2F0ZXdheSBBUk4gaXMgYSBDbG91ZEZvcm1hdGlvbiBpbnRyaW5zaWMgKEZuOjpHZXRBdHQpIGVtYmVkZGVkIGluc2lkZVxuICogdGhlIENlZGFyIHN0YXRlbWVudCBzdHJpbmdzLCBzbyB0aGUgc3RhdGVtZW50cyByZW5kZXIgYXMgYEZuOjpKb2luYFxuICogc3RydWN0dXJlcy4gV2UgYXNzZXJ0IG9uIHRoZSBzdGFibGUgbGl0ZXJhbCBzdWJzdHJpbmdzIG9mIGVhY2ggc3RhdGVtZW50XG4gKiAoYHRvb2xfY2F0ZWdvcnkgPT0gXCJiaWxsaW5nXCJgLCBgZ2V0VGFnKFwicm9sZVwiKSA9PSBcImFkbWluXCJgLCAuLi4pIHJhdGhlciB0aGFuXG4gKiB0aGUgZnVsbCBBUk4uXG4gKi9cbmRlc2NyaWJlKCdBZ2VudENvcmVHYXRld2F5U3RhY2snLCAoKSA9PiB7XG4gIGNvbnN0IEZST05URU5EX0NMSUVOVF9JRCA9ICdkdW1teS1mcm9udGVuZC1jbGllbnQtaWQnO1xuICBsZXQgdGVtcGxhdGU6IFRlbXBsYXRlO1xuXG4gIGJlZm9yZUFsbCgoKSA9PiB7XG4gICAgY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbiAgICBjb25zdCBzdGFjayA9IG5ldyBBZ2VudENvcmVHYXRld2F5U3RhY2soYXBwLCAnVGVzdEdhdGV3YXlTdGFjaycsIHtcbiAgICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9LFxuICAgICAgYmlsbGluZ01jcFJ1bnRpbWVBcm46ICdhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6cnVudGltZS9iaWxsaW5nJyxcbiAgICAgIGJpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQ6ICdodHRwczovL2JpbGxpbmcuZXhhbXBsZS5jb20vbWNwJyxcbiAgICAgIHByaWNpbmdNY3BSdW50aW1lQXJuOiAnYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnJ1bnRpbWUvcHJpY2luZycsXG4gICAgICBwcmljaW5nTWNwUnVudGltZUVuZHBvaW50OiAnaHR0cHM6Ly9wcmljaW5nLmV4YW1wbGUuY29tL21jcCcsXG4gICAgICBjbG91ZHdhdGNoTWNwUnVudGltZUFybjogJ2Fybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpydW50aW1lL2Nsb3Vkd2F0Y2gnLFxuICAgICAgY2xvdWR3YXRjaE1jcFJ1bnRpbWVFbmRwb2ludDogJ2h0dHBzOi8vY2xvdWR3YXRjaC5leGFtcGxlLmNvbS9tY3AnLFxuICAgICAgY2xvdWR0cmFpbE1jcFJ1bnRpbWVBcm46ICdhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6cnVudGltZS9jbG91ZHRyYWlsJyxcbiAgICAgIGNsb3VkdHJhaWxNY3BSdW50aW1lRW5kcG9pbnQ6ICdodHRwczovL2Nsb3VkdHJhaWwuZXhhbXBsZS5jb20vbWNwJyxcbiAgICAgIGludmVudG9yeU1jcFJ1bnRpbWVBcm46ICdhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6cnVudGltZS9pbnZlbnRvcnknLFxuICAgICAgaW52ZW50b3J5TWNwUnVudGltZUVuZHBvaW50OiAnaHR0cHM6Ly9pbnZlbnRvcnkuZXhhbXBsZS5jb20vbWNwJyxcbiAgICAgIGF1dGhVc2VyUG9vbElkOiAndXMtZWFzdC0xX0RVTU1ZUE9PTCcsXG4gICAgICBhdXRoVXNlclBvb2xBcm46ICdhcm46YXdzOmNvZ25pdG8taWRwOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dXNlcnBvb2wvdXMtZWFzdC0xX0RVTU1ZUE9PTCcsXG4gICAgICBhdXRoTTJtQ2xpZW50SWQ6ICdkdW1teS1tMm0tY2xpZW50LWlkJyxcbiAgICAgIGF1dGhVc2VyUG9vbENsaWVudElkOiBGUk9OVEVORF9DTElFTlRfSUQsXG4gICAgfSk7XG4gICAgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICB9KTtcblxuICAvKipcbiAgICogUmVjdXJzaXZlbHkgY29sbGVjdCBldmVyeSBzdHJpbmcgbGl0ZXJhbCBmcm9tIGEgdmFsdWUuIENsb3VkRm9ybWF0aW9uXG4gICAqIGludHJpbnNpY3MgKEZuOjpKb2luIC8gRm46OkdldEF0dCkgYXJlIHBsYWluIG9iamVjdHMvYXJyYXlzLCBzbyB0aGlzXG4gICAqIGZsYXR0ZW5zIGFuIEZuOjpKb2luJ2QgQ2VkYXIgc3RhdGVtZW50IGJhY2sgaW50byBpdHMgbGl0ZXJhbCBmcmFnbWVudHMuXG4gICAqL1xuICBmdW5jdGlvbiBjb2xsZWN0U3RyaW5ncyhub2RlOiB1bmtub3duKTogc3RyaW5nW10ge1xuICAgIGlmICh0eXBlb2Ygbm9kZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBbbm9kZV07XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KG5vZGUpKSB7XG4gICAgICByZXR1cm4gbm9kZS5mbGF0TWFwKGNvbGxlY3RTdHJpbmdzKTtcbiAgICB9XG4gICAgaWYgKG5vZGUgJiYgdHlwZW9mIG5vZGUgPT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyhub2RlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5mbGF0TWFwKGNvbGxlY3RTdHJpbmdzKTtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgdGVzdCgnR2F0ZXdheSB1c2VzIENVU1RPTV9KV1QgaW5ib3VuZCBhdXRob3JpemF0aW9uIChSZXEgMS41KScsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QmVkcm9ja0FnZW50Q29yZTo6R2F0ZXdheScsIHtcbiAgICAgIEF1dGhvcml6ZXJUeXBlOiAnQ1VTVE9NX0pXVCcsXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0NVU1RPTV9KV1QgYXV0aG9yaXplciBwb2ludHMgYXQgdGhlIENvZ25pdG8gZGlzY292ZXJ5IFVSTCBhbmQgYWxsb3dzIHRoZSBmcm9udGVuZCBjbGllbnQgKFJlcSAxLjUpJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpHYXRld2F5Jywge1xuICAgICAgQXV0aG9yaXplckNvbmZpZ3VyYXRpb246IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICBDdXN0b21KV1RBdXRob3JpemVyOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBEaXNjb3ZlcnlVcmw6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJy4qXFxcXC53ZWxsLWtub3duL29wZW5pZC1jb25maWd1cmF0aW9uJCcpLFxuICAgICAgICAgIC8vIENvZ25pdG8gYWNjZXNzIHRva2VucyBtYXRjaCBvbiBjbGllbnRfaWQgKEFsbG93ZWRDbGllbnRzKSwgbm90IGF1ZC5cbiAgICAgICAgICBBbGxvd2VkQ2xpZW50czogTWF0Y2guYXJyYXlXaXRoKFtGUk9OVEVORF9DTElFTlRfSURdKSxcbiAgICAgICAgfSksXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnR2F0ZXdheSBhc3NvY2lhdGVzIHRoZSBDZWRhciBQb2xpY3kgRW5naW5lIGluIEVORk9SQ0UgbW9kZScsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QmVkcm9ja0FnZW50Q29yZTo6R2F0ZXdheScsIHtcbiAgICAgIFBvbGljeUVuZ2luZUNvbmZpZ3VyYXRpb246IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICBNb2RlOiAnRU5GT1JDRScsXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnR2F0ZXdheSByZWdpc3RlcnMgYSBSRVFVRVNUIGludGVyY2VwdG9yIChkZW55LWF1ZGl0KScsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QmVkcm9ja0FnZW50Q29yZTo6R2F0ZXdheScsIHtcbiAgICAgIEludGVyY2VwdG9yQ29uZmlndXJhdGlvbnM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIEludGVyY2VwdGlvblBvaW50czogTWF0Y2guYXJyYXlXaXRoKFsnUkVRVUVTVCddKSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0NlZGFyIHBvbGljeSBzZXQgKFJlcSA2LjIsIDYuMyDigJQgZGVmYXVsdC1kZW55IGJ5IG9taXNzaW9uKScsICgpID0+IHtcbiAgICAvLyBMb2NhdGUgdGhlIGN1c3RvbSByZXNvdXJjZSB0aGF0IGNhcnJpZXMgdGhlIENlZGFyIHBvbGljeSBzdGF0ZW1lbnRzLlxuICAgIGZ1bmN0aW9uIGdldFBvbGljeVN0YXRlbWVudHMoKTogQXJyYXk8eyBOYW1lOiBzdHJpbmc7IFN0YXRlbWVudDogdW5rbm93biB9PiB7XG4gICAgICBjb25zdCBjdXN0b21SZXNvdXJjZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkNsb3VkRm9ybWF0aW9uOjpDdXN0b21SZXNvdXJjZScpO1xuICAgICAgY29uc3QgcG9saWN5UmVzb3VyY2VzID0gT2JqZWN0LnZhbHVlcyhjdXN0b21SZXNvdXJjZXMpLmZpbHRlcihcbiAgICAgICAgKHI6IGFueSkgPT4gci5Qcm9wZXJ0aWVzICYmIHIuUHJvcGVydGllcy5PcGVyYXRpb24gPT09ICdQT0xJQ0lFUycsXG4gICAgICApO1xuICAgICAgZXhwZWN0KHBvbGljeVJlc291cmNlcykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgY29uc3Qgc3RhdGVtZW50cyA9IChwb2xpY3lSZXNvdXJjZXNbMF0gYXMgYW55KS5Qcm9wZXJ0aWVzLlN0YXRlbWVudHM7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShzdGF0ZW1lbnRzKSkudG9CZSh0cnVlKTtcbiAgICAgIHJldHVybiBzdGF0ZW1lbnRzO1xuICAgIH1cblxuICAgIHRlc3QoJ2V4YWN0bHkgdHdvIHBlcm1pdCBzdGF0ZW1lbnRzIGFyZSBwcmVzZW50JywgKCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdGVtZW50cyA9IGdldFBvbGljeVN0YXRlbWVudHMoKTtcbiAgICAgIGV4cGVjdChzdGF0ZW1lbnRzKS50b0hhdmVMZW5ndGgoMik7XG5cbiAgICAgIC8vIEV2ZXJ5IENlZGFyIHN0YXRlbWVudCBpbiB0aGUgc2V0IGlzIGEgYHBlcm1pdGAgKG5vIGBmb3JiaWRgL2RlbnkgcnVsZXMpLFxuICAgICAgLy8gYW5kIHRoZXJlIGFyZSBleGFjdGx5IHR3byBvZiB0aGVtIGFjcm9zcyB0aGUgd2hvbGUgcG9saWN5IHNldC5cbiAgICAgIGNvbnN0IGFsbFRleHQgPSBjb2xsZWN0U3RyaW5ncyhzdGF0ZW1lbnRzKS5qb2luKCdcXG4nKTtcbiAgICAgIGNvbnN0IHBlcm1pdENvdW50ID0gKGFsbFRleHQubWF0Y2goL3Blcm1pdFxcKC9nKSB8fCBbXSkubGVuZ3RoO1xuICAgICAgZXhwZWN0KHBlcm1pdENvdW50KS50b0JlKDIpO1xuICAgICAgZXhwZWN0KGFsbFRleHQpLm5vdC50b0NvbnRhaW4oJ2ZvcmJpZCgnKTtcbiAgICB9KTtcblxuICAgIHRlc3QoJ2JpbGxpbmcvcHJpY2luZyBwZXJtaXQgYXBwbGllcyB0byBhbGwgdXNlcnMgYW5kIHJlZmVyZW5jZXMgbm8gb3RoZXIgdGFyZ2V0IGdyb3VwJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdGVtZW50cyA9IGdldFBvbGljeVN0YXRlbWVudHMoKTtcbiAgICAgIGNvbnN0IGFsbFVzZXJzID0gc3RhdGVtZW50cy5maW5kKChzKSA9PiBzLk5hbWUgPT09ICdhbGxvd19iaWxsaW5nX3ByaWNpbmdfYWxsX3VzZXJzJyk7XG4gICAgICBleHBlY3QoYWxsVXNlcnMpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAgIGNvbnN0IHRleHQgPSBjb2xsZWN0U3RyaW5ncyhhbGxVc2VycyEuU3RhdGVtZW50KS5qb2luKCdcXG4nKTtcbiAgICAgIC8vIFNjb3BlZCB0byB0aGUgYmlsbGluZy9wcmljaW5nIHRhcmdldCBhY3Rpb24gZ3JvdXBzIChubyBwZXItdG9vbCBlbnVtKS5cbiAgICAgIGV4cGVjdCh0ZXh0KS50b0NvbnRhaW4oJ0FnZW50Q29yZTo6QWN0aW9uOjpcImJpbGxpbmdNY3BcIicpO1xuICAgICAgZXhwZWN0KHRleHQpLnRvQ29udGFpbignQWdlbnRDb3JlOjpBY3Rpb246OlwicHJpY2luZ01jcFwiJyk7XG5cbiAgICAgIC8vIE5vdCBnYXRlZCBvbiB0aGUgYWRtaW4gcm9sZSB0YWcsIGFuZCBuZXZlciBncmFudHMgYW4gb3BzIGNhdGVnb3J5LlxuICAgICAgZXhwZWN0KHRleHQpLm5vdC50b0NvbnRhaW4oJ2dldFRhZyhcInJvbGVcIiknKTtcbiAgICAgIGV4cGVjdCh0ZXh0KS5ub3QudG9Db250YWluKCdjbG91ZHdhdGNoTWNwJyk7XG4gICAgICBleHBlY3QodGV4dCkubm90LnRvQ29udGFpbignY2xvdWR0cmFpbE1jcCcpO1xuICAgICAgZXhwZWN0KHRleHQpLm5vdC50b0NvbnRhaW4oJ2ludmVudG9yeU1jcCcpO1xuICAgIH0pO1xuXG4gICAgdGVzdCgnY2xvdWR3YXRjaC9jbG91ZHRyYWlsL2ludmVudG9yeSBwZXJtaXQgaXMgYWRtaW4tb25seSBhbmQgcmVmZXJlbmNlcyBubyBhbGwtdXNlciB0YXJnZXQgZ3JvdXAnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzdGF0ZW1lbnRzID0gZ2V0UG9saWN5U3RhdGVtZW50cygpO1xuICAgICAgY29uc3QgYWRtaW5Pbmx5ID0gc3RhdGVtZW50cy5maW5kKChzKSA9PiBzLk5hbWUgPT09ICdhbGxvd19vcHNfY2F0ZWdvcmllc19hZG1pbl9vbmx5Jyk7XG4gICAgICBleHBlY3QoYWRtaW5Pbmx5KS50b0JlRGVmaW5lZCgpO1xuXG4gICAgICBjb25zdCB0ZXh0ID0gY29sbGVjdFN0cmluZ3MoYWRtaW5Pbmx5IS5TdGF0ZW1lbnQpLmpvaW4oJ1xcbicpO1xuICAgICAgLy8gR3VhcmRlZCBvbiB0aGUgdmVyaWZpZWQgSldUIHJvbGUgY2xhaW0gKHN0b3JlZCBhcyBhIHByaW5jaXBhbCB0YWcpLlxuICAgICAgZXhwZWN0KHRleHQpLnRvQ29udGFpbignZ2V0VGFnKFwicm9sZVwiKSA9PSBcImFkbWluXCInKTtcbiAgICAgIGV4cGVjdCh0ZXh0KS50b0NvbnRhaW4oJ0FnZW50Q29yZTo6QWN0aW9uOjpcImNsb3Vkd2F0Y2hNY3BcIicpO1xuICAgICAgZXhwZWN0KHRleHQpLnRvQ29udGFpbignQWdlbnRDb3JlOjpBY3Rpb246OlwiY2xvdWR0cmFpbE1jcFwiJyk7XG4gICAgICBleHBlY3QodGV4dCkudG9Db250YWluKCdBZ2VudENvcmU6OkFjdGlvbjo6XCJpbnZlbnRvcnlNY3BcIicpO1xuXG4gICAgICAvLyBUaGUgYWRtaW4gcGVybWl0IG11c3Qgbm90IHNpbGVudGx5IHdpZGVuIGJpbGxpbmcvcHJpY2luZyBhY2Nlc3MuXG4gICAgICBleHBlY3QodGV4dCkubm90LnRvQ29udGFpbignQWdlbnRDb3JlOjpBY3Rpb246OlwiYmlsbGluZ01jcFwiJyk7XG4gICAgICBleHBlY3QodGV4dCkubm90LnRvQ29udGFpbignQWdlbnRDb3JlOjpBY3Rpb246OlwicHJpY2luZ01jcFwiJyk7XG4gICAgfSk7XG5cbiAgICB0ZXN0KCdubyBwZXJtaXQgZXhpc3RzIGZvciBhbnkgdGFyZ2V0IGdyb3VwIG91dHNpZGUgdGhlIGRvY3VtZW50ZWQgZml2ZSAoZGVmYXVsdC1kZW55KScsICgpID0+IHtcbiAgICAgIGNvbnN0IHN0YXRlbWVudHMgPSBnZXRQb2xpY3lTdGF0ZW1lbnRzKCk7XG4gICAgICBjb25zdCBhbGxUZXh0ID0gY29sbGVjdFN0cmluZ3Moc3RhdGVtZW50cykuam9pbignXFxuJyk7XG5cbiAgICAgIC8vIENvbGxlY3QgZXZlcnkgdGFyZ2V0IGFjdGlvbiBncm91cCByZWZlcmVuY2VkIGFueXdoZXJlIGluIHRoZSBwb2xpY3kgc2V0LlxuICAgICAgY29uc3QgcmVmZXJlbmNlZCA9IG5ldyBTZXQoXG4gICAgICAgIEFycmF5LmZyb20oYWxsVGV4dC5tYXRjaEFsbCgvQWdlbnRDb3JlOjpBY3Rpb246OlwiKFteXCJdKylcIi9nKSkubWFwKChtKSA9PiBtWzFdKSxcbiAgICAgICk7XG4gICAgICBjb25zdCBhbGxvd2VkID0gbmV3IFNldChbXG4gICAgICAgICdiaWxsaW5nTWNwJyxcbiAgICAgICAgJ3ByaWNpbmdNY3AnLFxuICAgICAgICAnY2xvdWR3YXRjaE1jcCcsXG4gICAgICAgICdjbG91ZHRyYWlsTWNwJyxcbiAgICAgICAgJ2ludmVudG9yeU1jcCcsXG4gICAgICBdKTtcbiAgICAgIGZvciAoY29uc3QgdGFyZ2V0IG9mIHJlZmVyZW5jZWQpIHtcbiAgICAgICAgZXhwZWN0KGFsbG93ZWQuaGFzKHRhcmdldCkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgICAvLyBBbGwgZml2ZSBrbm93biB0YXJnZXQgZ3JvdXBzIGFyZSBhY2NvdW50ZWQgZm9yOyBhbnl0aGluZyBlbHNlIChpbmNsLlxuICAgICAgLy8gZnV0dXJlIHRhcmdldHMpIGlzIGRlbmllZCBieSBvbWlzc2lvbiBmb3Igbm9uLWFkbWlucy5cbiAgICAgIGV4cGVjdChyZWZlcmVuY2VkKS50b0VxdWFsKGFsbG93ZWQpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19