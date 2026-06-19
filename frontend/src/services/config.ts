import { AppConfig } from '@/types';

export function getAppConfig(): AppConfig {
  const raw = localStorage.getItem('appConfig');
  if (!raw) {
    throw new Error(
      'App configuration not found in localStorage. Please set up the application configuration.'
    );
  }
  try {
    const parsed = JSON.parse(raw) as AppConfig;
    // Validate that required cognito section exists
    if (!parsed.cognito?.userPoolId) {
      throw new Error('Invalid app configuration: cognito.userPoolId is required.');
    }
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Invalid app configuration format in localStorage.');
    }
    throw e;
  }
}

export function isConfigured(): boolean {
  try {
    const raw = localStorage.getItem('appConfig');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.cognito?.userPoolId);
  } catch {
    return false;
  }
}

export function getAgentName(config: AppConfig): string {
  if (config.agentcore?.enabled && config.agentcore?.agentName) return config.agentcore.agentName;
  if (config.bedrock?.agentName) return config.bedrock.agentName;
  if (config.strands?.enabled && config.strands?.agentName) return config.strands.agentName;
  return 'CloudOps Agent';
}

export function getConversationApiEndpoint(): string {
  const config = getAppConfig();
  if (!config.conversationApi?.endpoint) {
    throw new Error('Conversation API endpoint not configured. Please update settings.');
  }
  return config.conversationApi.endpoint;
}
