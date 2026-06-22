import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invokeAgent, AgentCoreError } from './agentCore';
import { AppConfig, AgentCredentials } from '@/types';

/**
 * Tests for FrontEnd identity propagation into the Agent Runtime call.
 *
 * Task 8.3 / Requirement 7.1: when an authenticated Cognito token is available,
 * invoking the agent must convey that token to the runtime. The wire-level
 * contract in `invokeAgent` is that the token is placed in the request body's
 * `accessToken` field. These tests mock `fetch` to capture the body and assert
 * the token is included when passed and omitted when not.
 */

const config: AppConfig = {
  cognito: {
    userPoolId: 'us-east-1_test',
    userPoolClientId: 'client-id',
    identityPoolId: 'us-east-1:pool',
    region: 'us-east-1',
  },
  agentcore: {
    enabled: true,
    region: 'us-east-1',
    agentArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-agent',
  },
};

const credentials: AgentCredentials = {
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
  sessionToken: 'session-token',
};

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    // No streaming body — invokeAgent falls back to response.text()
    body: null,
    text: async () => JSON.stringify({ result: 'agent reply' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Pull the JSON body that was sent to fetch on its first call. */
function capturedBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe('invokeAgent identity propagation (Req 7.1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes the accessToken field in the request body when a token is provided', async () => {
    const fetchMock = mockFetchOk();

    const result = await invokeAgent(
      'what are my costs?',
      'session-123',
      config,
      credentials,
      'cognito-jwt-token'
    );

    expect(result).toBe('agent reply');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = capturedBody(fetchMock);
    expect(body.accessToken).toBe('cognito-jwt-token');
    // Sanity: the core payload fields are still present
    expect(body.prompt).toBe('what are my costs?');
    expect(body.sessionId).toBe('session-123');
  });

  it('conveys the exact token unmodified (byte-for-byte)', async () => {
    const fetchMock = mockFetchOk();
    const token = 'header.payload.signature-with-RoleClaim==';

    await invokeAgent('hello', 'session-xyz', config, credentials, token);

    const body = capturedBody(fetchMock);
    expect(body.accessToken).toBe(token);
  });

  it('omits the accessToken field when no token is provided', async () => {
    const fetchMock = mockFetchOk();

    await invokeAgent('hello', 'session-123', config, credentials);

    const body = capturedBody(fetchMock);
    expect(body).not.toHaveProperty('accessToken');
  });

  it('omits the accessToken field when the token is null', async () => {
    const fetchMock = mockFetchOk();

    await invokeAgent('hello', 'session-123', config, credentials, null);

    const body = capturedBody(fetchMock);
    expect(body).not.toHaveProperty('accessToken');
  });

  it('throws before any fetch when AgentCore is disabled', async () => {
    const fetchMock = mockFetchOk();
    const disabled: AppConfig = { ...config, agentcore: { ...config.agentcore, enabled: false } };

    await expect(
      invokeAgent('hello', 'session-123', disabled, credentials, 'token')
    ).rejects.toBeInstanceOf(AgentCoreError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
