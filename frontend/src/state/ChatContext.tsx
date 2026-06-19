import React, { createContext, useContext, useReducer, useRef, useCallback } from 'react';
import { chatReducer, initialChatState } from '@/state/chatReducer';
import { invokeAgent } from '@/services/agentCore';
import { getOrCreateSession, resetSession } from '@/services/session';
import { getAppConfig } from '@/services/config';
import { Message, AgentCredentials } from '@/types';
import { appendMessages } from '@/services/conversationService';
import { fetchAuthSession } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';

interface ChatContextValue {
  messages: Message[];
  isLoading: boolean;
  progressMessage: string | null;
  error: { message: string; originalPrompt: string } | null;
  sessionId: string;
  sendMessage: (content: string, credentials: AgentCredentials) => void;
  retryMessage: (credentials: AgentCredentials) => void;
  clearMessages: () => void;
  cancelRequest: () => void;
  setMessages: (messages: Message[]) => void;
  setSessionId: (id: string) => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

const REQUEST_TIMEOUT_MS = 60000;

async function getAuthToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() || null;
  } catch {
    return null;
  }
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  // Map of conversationId → AbortController for in-flight requests
  // This allows multiple concurrent requests (one per conversation)
  const activeRequestsRef = useRef<Map<string, AbortController>>(new Map());
  const sessionIdRef = useRef<string>(getOrCreateSession());

  const cancelRequest = useCallback(() => {
    // Cancel only the current conversation's request
    const currentId = sessionIdRef.current;
    const controller = activeRequestsRef.current.get(currentId);
    if (controller) {
      controller.abort();
      activeRequestsRef.current.delete(currentId);
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string, credentials: AgentCredentials) => {
      // Capture the conversation this request belongs to AT SEND TIME
      const targetConversationId = sessionIdRef.current;

      // Only abort if there's already a request for THIS conversation
      const existingController = activeRequestsRef.current.get(targetConversationId);
      if (existingController) {
        existingController.abort();
        activeRequestsRef.current.delete(targetConversationId);
      }

      // Create the user message
      const userMessage: Message = {
        id: uuidv4(),
        role: 'user',
        content,
        timestamp: Date.now(),
        status: 'sent',
      };

      dispatch({ type: 'SEND_MESSAGE', payload: { content } });

      // Save user message to API immediately
      const token = await getAuthToken();
      if (token && targetConversationId) {
        appendMessages(token, targetConversationId, [userMessage]).catch(() => {
          // Non-critical
        });
      }

      const controller = new AbortController();
      activeRequestsRef.current.set(targetConversationId, controller);
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const config = getAppConfig();
        const result = await invokeAgent(
          content,
          targetConversationId,
          config,
          credentials,
          controller.signal
        );

        // Create agent message
        const agentMessage: Message = {
          id: uuidv4(),
          role: 'agent',
          content: result,
          timestamp: Date.now(),
          status: 'delivered',
        };

        // Check if user is still on the same conversation
        if (sessionIdRef.current === targetConversationId) {
          // Same conversation — show response in UI
          dispatch({ type: 'RECEIVE_MESSAGE', payload: { content: result } });
        } else {
          // User switched away — don't touch UI state (they're viewing a different conversation)
          // The response is still saved below to the correct conversation
        }

        // Save agent response to API (always save to TARGET conversation)
        const saveToken = await getAuthToken();
        if (saveToken && targetConversationId) {
          appendMessages(saveToken, targetConversationId, [agentMessage]).catch(() => {
            // Non-critical
          });
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Only clear loading if still on same conversation
          if (sessionIdRef.current === targetConversationId) {
            dispatch({ type: 'SET_LOADING', payload: false });
          }
          return;
        }

        // Only show error in UI if still on same conversation
        if (sessionIdRef.current === targetConversationId) {
          const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
          dispatch({
            type: 'SET_ERROR',
            payload: { message, originalPrompt: content },
          });
        }
      } finally {
        clearTimeout(timeoutId);
        activeRequestsRef.current.delete(targetConversationId);
      }
    },
    []
  );

  const retryMessage = useCallback(
    (credentials: AgentCredentials) => {
      if (!state.error?.originalPrompt) return;
      const originalPrompt = state.error.originalPrompt;
      sendMessage(originalPrompt, credentials);
    },
    [state.error, sendMessage]
  );

  const clearMessages = useCallback(() => {
    cancelRequest();
    sessionIdRef.current = resetSession();
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, [cancelRequest]);

  const setMessages = useCallback((messages: Message[]) => {
    dispatch({ type: 'SET_MESSAGES', payload: messages });
  }, []);

  const setSessionId = useCallback((id: string) => {
    sessionIdRef.current = id;
  }, []);

  const value: ChatContextValue = {
    messages: state.messages,
    isLoading: state.isLoading,
    progressMessage: state.progressMessage,
    error: state.error,
    sessionId: sessionIdRef.current,
    sendMessage,
    retryMessage,
    clearMessages,
    cancelRequest,
    setMessages,
    setSessionId,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
}
