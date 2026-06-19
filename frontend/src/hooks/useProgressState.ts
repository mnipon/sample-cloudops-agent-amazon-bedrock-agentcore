import { useState, useEffect, useRef } from 'react';

export const PROGRESS_MESSAGES = [
  'Analyzing your request...',
  'Querying AWS services...',
  'Processing results...',
  'Generating response...',
  'Almost there...',
];

const PROGRESS_DELAY_MS = 3000;
const CYCLE_INTERVAL_MS = 4000;

export function useProgressState(isLoading: boolean): string | null {
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isLoading) {
      setProgressMessage(null);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    let index = 0;

    timerRef.current = setTimeout(() => {
      setProgressMessage(PROGRESS_MESSAGES[0]);

      intervalRef.current = setInterval(() => {
        index = (index + 1) % PROGRESS_MESSAGES.length;
        setProgressMessage(PROGRESS_MESSAGES[index]);
      }, CYCLE_INTERVAL_MS);
    }, PROGRESS_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLoading]);

  return progressMessage;
}
