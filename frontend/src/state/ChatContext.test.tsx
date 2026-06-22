import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for FrontEnd identity propagation guard in ChatContext.sendMessage.
 *
 * Task 8.3:
 *  - Req 7.5: when there is no authenticated identity (no resolvable Cognito
 *    token), the SPA must NOT invoke the Agent Runtime; an auth-required error
 *    is surfaced and the runtime call is skipped.
 *  - Req 7.1: when an authenticated token resolves, sendMessage conveys that
 *    token to the runtime (passed through to invokeAgent).
 *
 * `aws-amplify/auth` (fetchAuthSession) and the agentCore service are mocked so
 * we can control the auth state and observe whether the runtime is invoked.
 */

const fetchAuthSessionMock = vi.fn();
const invokeAgentMock = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: () => fetchAuthSessionMock(),
}));

vi.mock('@/services/agentCore', () => ({
  invokeAgent: (...args: unknown[]) => invokeAgentMock(...args),
  AgentCoreError: class AgentCoreError extends Error {},
}));

vi.mock('@/services/config', () => ({
  getAppConfig: () => ({
    cognito: {
      userPoolId: 'us-east-1_test',
      userPoolClientId: 'client',
      identityPoolId: 'pool',
      region: 'us-east-1',
    },
    agentcore: { enabled: true, region: 'us-east-1', agentArn: 'arn:test' },
  }),
}));

vi.mock('@/services/conversationService', () => ({
  appendMessages: vi.fn().mockResolvedValue(undefined),
}));

import { ChatProvider, useChatContext } from './ChatContext';

const credentials = { accessKeyId: 'AKIA', secretAccessKey: 'secret' };

function wrapper({ children }: { children: React.ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}

/** Build a fake Amplify auth session with the given token strings. */
function session({ accessToken, idToken }: { accessToken?: string; idToken?: string }) {
  return {
    tokens: {
      ...(accessToken ? { accessToken: { toString: () => accessToken } } : {}),
      ...(idToken ? { idToken: { toString: () => idToken } } : {}),
    },
  };
}

describe('ChatContext.sendMessage identity guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT invoke the runtime when no authenticated identity exists (Req 7.5)', async () => {
    // No tokens resolvable → getRuntimeToken() returns null
    fetchAuthSessionMock.mockResolvedValue({ tokens: undefined });

    const { result } = renderHook(() => useChatContext(), { wrapper });

    await act(async () => {
      await result.current.sendMessage('show me cloudwatch logs', credentials);
    });

    expect(invokeAgentMock).not.toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.originalPrompt).toBe('show me cloudwatch logs');
    expect(result.current.error?.message).toMatch(/signed in/i);
  });

  it('does NOT invoke the runtime when fetchAuthSession rejects (Req 7.5)', async () => {
    // getRuntimeToken swallows the error and returns null
    fetchAuthSessionMock.mockRejectedValue(new Error('no session'));

    const { result } = renderHook(() => useChatContext(), { wrapper });

    await act(async () => {
      await result.current.sendMessage('hello', credentials);
    });

    expect(invokeAgentMock).not.toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
  });

  it('invokes the runtime and conveys the resolved token when authenticated (Req 7.1)', async () => {
    fetchAuthSessionMock.mockResolvedValue(session({ accessToken: 'access-jwt' }));
    invokeAgentMock.mockResolvedValue('agent reply');

    const { result } = renderHook(() => useChatContext(), { wrapper });

    await act(async () => {
      await result.current.sendMessage('what are my costs?', credentials);
    });

    expect(invokeAgentMock).toHaveBeenCalledTimes(1);
    const callArgs = invokeAgentMock.mock.calls[0];
    // invokeAgent(content, sessionId, config, credentials, token, signal)
    expect(callArgs[0]).toBe('what are my costs?');
    expect(callArgs[4]).toBe('access-jwt');
    expect(result.current.error).toBeNull();
  });

  it('prefers the access token but falls back to the ID token (Req 7.1)', async () => {
    fetchAuthSessionMock.mockResolvedValue(session({ idToken: 'id-jwt' }));
    invokeAgentMock.mockResolvedValue('agent reply');

    const { result } = renderHook(() => useChatContext(), { wrapper });

    await act(async () => {
      await result.current.sendMessage('hello', credentials);
    });

    expect(invokeAgentMock).toHaveBeenCalledTimes(1);
    expect(invokeAgentMock.mock.calls[0][4]).toBe('id-jwt');
  });
});
