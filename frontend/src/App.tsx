import { useCallback, useEffect, useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { ChatProvider, useChatContext } from '@/state/ChatContext';
import { ConversationProvider, useConversationContext } from '@/state/ConversationContext';
import { useProgressState } from '@/hooks/useProgressState';
import { getAppConfig, getAgentName, isConfigured } from '@/services/config';
import { ChatLayout } from '@/components/ChatLayout/ChatLayout';
import { ConfigEditor } from '@/components/ConfigEditor/ConfigEditor';
import type { AgentCredentials } from '@/types';

// Configure Amplify with Cognito settings from localStorage appConfig (if available)
if (isConfigured()) {
  const config = getAppConfig();
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.cognito.userPoolId,
        userPoolClientId: config.cognito.userPoolClientId,
        identityPoolId: config.cognito.identityPoolId,
      },
    },
  });
}

function App() {
  const [showConfig, setShowConfig] = useState(!isConfigured());

  if (showConfig) {
    return <ConfigEditor onClose={isConfigured() ? () => setShowConfig(false) : undefined} />;
  }

  return (
    <div className="auth-wrapper">
      <Authenticator
        hideSignUp={true}
        components={{
          Header() {
            return (
              <div style={{
                textAlign: 'center',
                padding: '24px 24px 0',
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                  fontSize: '20px',
                  color: '#fff',
                }}>
                  ✦
                </div>
                <h2 style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#1e293b',
                  margin: '0 0 4px',
                }}>
                  CloudOps Agent
                </h2>
                <p style={{
                  fontSize: '14px',
                  color: '#64748b',
                  margin: 0,
                }}>
                  Agentic AI powered by Amazon Bedrock AgentCore
                </p>
              </div>
            );
          },
        }}
      >
        {({ user, signOut }) => (
          <ConversationProvider>
            <ChatProvider>
              <ChatLayoutWired
                user={user}
                signOut={signOut}
                onOpenSettings={() => setShowConfig(true)}
              />
            </ChatProvider>
          </ConversationProvider>
        )}
      </Authenticator>
    </div>
  );
}

interface ChatLayoutWiredProps {
  user: any;
  signOut: (() => void) | undefined;
  onOpenSettings: () => void;
}

function ChatLayoutWired({ user, signOut, onOpenSettings }: ChatLayoutWiredProps) {
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    retryMessage,
    cancelRequest,
    setMessages,
    setSessionId,
  } = useChatContext();

  const {
    conversations,
    activeConversationId,
    isLoadingList,
    listError,
    loadConversations,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
  } = useConversationContext();

  const progressMessage = useProgressState(isLoading);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Derive user name from Amplify Auth user attributes or default to "User"
  const userName =
    user?.signInDetails?.loginId?.split('@')[0] ||
    user?.username ||
    'User';

  // Get agent name from config
  let agentName = 'CloudOps Agent';
  try {
    agentName = getAgentName(getAppConfig());
  } catch {
    // Use default if config not available
  }

  // Get credentials from Amplify Auth session for API calls
  const getCredentials = useCallback(async (): Promise<AgentCredentials> => {
    const session = await fetchAuthSession();
    const credentials = session.credentials;
    if (!credentials) {
      throw new Error('Unable to retrieve authentication credentials');
    }
    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    };
  }, []);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const credentials = await getCredentials();
      sendMessage(text, credentials);
    },
    [getCredentials, sendMessage]
  );

  const handleRetry = useCallback(async () => {
    const credentials = await getCredentials();
    retryMessage(credentials);
  }, [getCredentials, retryMessage]);

  const handleNewConversation = useCallback(async () => {
    try {
      const newId = await createConversation();
      // Don't call clearMessages() — that would cancel in-flight requests for the current conversation
      // Just clear the UI and switch session
      setMessages([]);
      setSessionId(newId);
    } catch {
      // ConversationContext handles the error state
    }
  }, [createConversation, setMessages, setSessionId]);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      if (id === activeConversationId) return;
      try {
        const loadedMessages = await switchConversation(id);
        setMessages(loadedMessages);
        setSessionId(id);
      } catch {
        // ConversationContext handles the error state
      }
    },
    [activeConversationId, switchConversation, setMessages, setSessionId]
  );

  const handleRetryLoad = useCallback(() => {
    loadConversations();
  }, [loadConversations]);

  return (
    <ChatLayout
      messages={messages}
      isLoading={isLoading}
      progressMessage={progressMessage}
      error={error}
      agentName={agentName}
      userName={userName}
      onSendMessage={handleSendMessage}
      onRetry={handleRetry}
      onClearMessages={handleNewConversation}
      onCancelRequest={cancelRequest}
      onOpenSettings={onOpenSettings}
      onLogout={signOut}
      conversations={conversations}
      activeConversationId={activeConversationId}
      isLoadingList={isLoadingList}
      listError={listError}
      onSelectConversation={handleSelectConversation}
      onNewConversation={handleNewConversation}
      onRenameConversation={renameConversation}
      onDeleteConversation={deleteConversation}
      onRetryLoad={handleRetryLoad}
    />
  );
}

export default App;
