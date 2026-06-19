import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useProgressState, PROGRESS_MESSAGES } from './useProgressState';

describe('useProgressState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when isLoading is false', () => {
    const { result } = renderHook(() => useProgressState(false));
    expect(result.current).toBeNull();
  });

  it('returns null initially when isLoading is true (before 3s delay)', () => {
    const { result } = renderHook(() => useProgressState(true));
    expect(result.current).toBeNull();
  });

  it('shows first message after 3000ms delay', () => {
    const { result } = renderHook(() => useProgressState(true));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current).toBe(PROGRESS_MESSAGES[0]);
  });

  it('cycles to second message after 3000ms + 4000ms', () => {
    const { result } = renderHook(() => useProgressState(true));

    act(() => {
      vi.advanceTimersByTime(3000 + 4000);
    });

    expect(result.current).toBe(PROGRESS_MESSAGES[1]);
  });

  it('cycles through all messages and wraps around', () => {
    const { result } = renderHook(() => useProgressState(true));

    // Advance past initial delay
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(PROGRESS_MESSAGES[0]);

    // Cycle through remaining messages
    for (let i = 1; i < PROGRESS_MESSAGES.length; i++) {
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(result.current).toBe(PROGRESS_MESSAGES[i]);
    }

    // Wraps around to first message (index 0)
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current).toBe(PROGRESS_MESSAGES[0]);
  });

  it('resets to null when isLoading becomes false', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useProgressState(isLoading),
      { initialProps: { isLoading: true } }
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(PROGRESS_MESSAGES[0]);

    rerender({ isLoading: false });
    expect(result.current).toBeNull();
  });

  it('does not show message if loading stops before 3s delay', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useProgressState(isLoading),
      { initialProps: { isLoading: true } }
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBeNull();

    rerender({ isLoading: false });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBeNull();
  });

  it('exports PROGRESS_MESSAGES array with expected values', () => {
    expect(PROGRESS_MESSAGES).toEqual([
      'Analyzing your request...',
      'Querying AWS services...',
      'Processing results...',
      'Generating response...',
      'Almost there...',
    ]);
  });
});
