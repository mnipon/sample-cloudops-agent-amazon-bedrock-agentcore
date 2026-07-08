const SESSION_KEY = 'cloudops-session-id';

export function getOrCreateSession(): string {
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = generateSessionId();
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
}

export function resetSession(): string {
  const newSessionId = generateSessionId();
  sessionStorage.setItem(SESSION_KEY, newSessionId);
  return newSessionId;
}

function generateSessionId(): string {
  const timestamp = Date.now();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `agentcore-session-${timestamp}-${hex}`;
}
