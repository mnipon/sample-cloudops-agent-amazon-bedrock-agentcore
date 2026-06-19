import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodeBlock } from './CodeBlock';

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders code content in a pre > code block', () => {
    render(<CodeBlock code="const x = 1;" />);
    const codeEl = screen.getByText('const x = 1;');
    expect(codeEl).toBeInTheDocument();
    expect(codeEl.tagName).toBe('CODE');
    expect(codeEl.parentElement?.tagName).toBe('PRE');
  });

  it('displays language label when language prop is provided', () => {
    render(<CodeBlock code="print('hello')" language="python" />);
    expect(screen.getByText('python')).toBeInTheDocument();
  });

  it('does not display language label when language prop is not provided', () => {
    render(<CodeBlock code="some code" />);
    expect(screen.queryByText('python')).not.toBeInTheDocument();
  });

  it('applies language className for syntax highlighting', () => {
    render(<CodeBlock code="const x = 1;" language="typescript" />);
    const codeEl = screen.getByText('const x = 1;');
    expect(codeEl.className).toContain('language-typescript');
  });

  it('shows Copy button when clipboard API is available', () => {
    render(<CodeBlock code="test code" />);
    expect(screen.getByRole('button', { name: /copy code to clipboard/i })).toBeInTheDocument();
  });

  it('copies code to clipboard on button click', async () => {
    const code = 'const hello = "world";';
    render(<CodeBlock code={code} />);

    const copyBtn = screen.getByRole('button', { name: /copy code to clipboard/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code);
  });

  it('shows "Copied!" for 2 seconds after successful copy', async () => {
    render(<CodeBlock code="test" />);

    const copyBtn = screen.getByRole('button', { name: /copy code to clipboard/i });
    expect(copyBtn).toHaveTextContent('Copy');

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(copyBtn).toHaveTextContent('Copied!');
    expect(copyBtn).toHaveAttribute('aria-label', 'Copied to clipboard');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyBtn).toHaveTextContent('Copy');
    expect(copyBtn).toHaveAttribute('aria-label', 'Copy code to clipboard');
  });

  it('hides copy button when clipboard API is unavailable', () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<CodeBlock code="test" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('handles clipboard write failure gracefully', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });

    render(<CodeBlock code="test" />);
    const copyBtn = screen.getByRole('button', { name: /copy code to clipboard/i });

    // Should not throw
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // Button should still show "Copy" since the write failed
    expect(copyBtn).toHaveTextContent('Copy');
  });
});
