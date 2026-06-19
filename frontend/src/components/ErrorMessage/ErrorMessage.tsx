import type { ErrorMessageProps } from '@/types';
import styles from './ErrorMessage.module.css';

export function ErrorMessage({ error, onRetry, onCancel }: ErrorMessageProps) {
  return (
    <div
      className={styles.container}
      role="alert"
      aria-live="assertive"
    >
      <div className={styles.content}>
        <span className={styles.icon} aria-hidden="true">⚠️</span>
        <p className={styles.errorText}>{error}</p>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.retryButton}
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
        <button
          className={styles.cancelButton}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
