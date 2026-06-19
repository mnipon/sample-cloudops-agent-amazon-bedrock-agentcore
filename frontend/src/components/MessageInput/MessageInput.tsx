import { useState, useRef, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import type { MessageInputProps } from '@/types';
import styles from './MessageInput.module.css';

const MAX_CHARS = 2000;
const MAX_ROWS = 5;

export function MessageInput({ onSend, disabled, onCancel }: MessageInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSubmit = value.trim().length > 0 && !disabled;

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const maxHeight = lineHeight * MAX_ROWS;
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (newValue.length <= MAX_CHARS) {
      setValue(newValue);
    } else {
      setValue(newValue.slice(0, MAX_CHARS));
    }
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        autoResize(textareaRef.current);
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) {
        submit();
      }
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    onSend(value.trim());
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.overflowY = 'hidden';
      textareaRef.current.focus();
    }
  };

  const handleSendClick = () => {
    if (canSubmit) {
      submit();
    }
  };

  return (
    <div className={styles.container}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Ask about your AWS costs, metrics, or activity..."
        aria-label="Message input"
        rows={1}
      />
      {disabled && onCancel ? (
        <button
          className={styles.cancelButton}
          onClick={onCancel}
          aria-label="Cancel request"
          type="button"
        >
          ■ Stop
        </button>
      ) : (
        <button
          className={styles.sendButton}
          onClick={handleSendClick}
          disabled={!canSubmit}
          aria-label="Send message"
          type="button"
        >
          ▶
        </button>
      )}
    </div>
  );
}
