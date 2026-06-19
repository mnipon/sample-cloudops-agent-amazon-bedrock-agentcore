import type { ScrollToBottomProps } from '@/types';
import styles from './ScrollToBottom.module.css';

export function ScrollToBottom({ onClick, visible }: ScrollToBottomProps) {
  return (
    <div className={styles.scrollToBottom}>
      <button
        className={`${styles.scrollToBottomButton} ${!visible ? styles.hidden : ''}`}
        onClick={onClick}
        aria-label="Scroll to bottom"
        type="button"
      >
        ↓
      </button>
    </div>
  );
}
