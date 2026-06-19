import { useRef, useState, useEffect, useCallback } from 'react';
import type { Message } from '@/types';

const SCROLL_THRESHOLD = 100;

export function useAutoScroll(messages: Message[], isLoading: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  // Track previous message count to detect bulk loads (conversation switch) vs incremental messages
  const prevMessageCountRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
    setIsUserScrolledUp(!atBottom);
  }, []);

  useEffect(() => {
    if (!isUserScrolledUp && containerRef.current) {
      const prevCount = prevMessageCountRef.current;
      const currentCount = messages.length;
      // If messages changed by more than 2 (bulk load / conversation switch), scroll instantly
      // If just 1-2 new messages (normal chat), scroll smoothly
      const isBulkLoad = Math.abs(currentCount - prevCount) > 2 || prevCount === 0;

      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: isBulkLoad ? 'instant' : 'smooth',
      });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, isLoading, isUserScrolledUp]);

  const scrollToBottom = useCallback(() => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: 'smooth',
    });
    setIsUserScrolledUp(false);
  }, []);

  return { containerRef, isUserScrolledUp, handleScroll, scrollToBottom };
}
