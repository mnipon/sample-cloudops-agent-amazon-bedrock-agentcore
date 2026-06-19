import { useState, useCallback } from 'react';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [clipboardAvailable] = useState(() => typeof navigator !== 'undefined' && !!navigator.clipboard);

  const handleCopy = useCallback(async () => {
    if (!clipboardAvailable) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      // Clipboard write failed (e.g. permissions denied) — silently ignore
    }
  }, [code, clipboardAvailable]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {language && (
          <span className={styles.language}>{language}</span>
        )}
        {clipboardAvailable && (
          <button
            type="button"
            className={`${styles.copyButton} ${copyState === 'copied' ? styles.copied : ''}`}
            onClick={handleCopy}
            aria-label={copyState === 'copied' ? 'Copied to clipboard' : 'Copy code to clipboard'}
          >
            {copyState === 'copied' ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
      <pre className={styles.pre}>
        <code className={`${styles.code} ${language ? `hljs language-${language}` : ''}`}>
          {code}
        </code>
      </pre>
    </div>
  );
}
