import type { Message } from '@/types';
import { TypingIndicator } from '@/components/TypingIndicator/TypingIndicator';
import { MarkdownRenderer } from '@/components/MarkdownRenderer/MarkdownRenderer';
import { ScrollToBottom } from '@/components/MessageDisplay/ScrollToBottom';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import styles from './MessageDisplay.module.css';

interface MessageDisplayProps {
  messages: Message[];
  isLoading: boolean;
  progressMessage: string | null;
  userName?: string;
}

function UserMessage({ message }: { message: Message; userName: string }) {
  return (
    <div className={styles.userMessageRow} aria-label="Your message">
      <div className={styles.userMessage}>
        {message.content}
      </div>
      <div className={styles.userAvatar} aria-hidden="true">
        You
      </div>
    </div>
  );
}

function AgentMessage({ message }: { message: Message }) {
  return (
    <div className={styles.agentMessageRow} aria-label="Agent message">
      <div className={styles.agentAvatar} aria-hidden="true">
        ✦
      </div>
      <div className={styles.agentMessage}>
        <MarkdownRenderer content={message.content} />
      </div>
    </div>
  );
}

export function MessageDisplay({
  messages,
  isLoading,
  progressMessage,
  userName = 'User',
}: MessageDisplayProps) {
  const { containerRef, isUserScrolledUp, handleScroll, scrollToBottom } =
    useAutoScroll(messages, isLoading);

  return (
    <div
      className={styles.container}
      ref={containerRef}
      onScroll={handleScroll}
      role="log"
      aria-label="Chat messages"
    >
      <div className={styles.messageList}>
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserMessage key={msg.id} message={msg} userName={userName} />
          ) : (
            <AgentMessage key={msg.id} message={msg} />
          )
        )}
        {isLoading && (
          <TypingIndicator progressMessage={progressMessage} />
        )}
      </div>

      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {messages.length > 0 &&
          messages[messages.length - 1].role === 'agent' &&
          messages[messages.length - 1].content}
      </div>

      <ScrollToBottom
        onClick={scrollToBottom}
        visible={isUserScrolledUp}
      />
    </div>
  );
}
