import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageInput } from './MessageInput';

describe('MessageInput', () => {
  it('renders textarea with correct placeholder', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute(
      'placeholder',
      'Ask about your AWS costs, metrics, or activity...'
    );
  });

  it('renders a send button', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);
    const button = screen.getByLabelText('Send message');
    expect(button).toBeInTheDocument();
  });

  it('sends message on Enter when input has non-whitespace content', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Hello world');
  });

  it('clears input after submission', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const textarea = screen.getByLabelText('Message input') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(textarea.value).toBe('');
  });

  it('does not submit on Enter when input is whitespace only', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not submit on Enter when input is empty', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('inserts newline on Shift+Enter without submitting', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'Line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('enforces 2000 character limit', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByLabelText('Message input') as HTMLTextAreaElement;

    const longText = 'a'.repeat(2100);
    fireEvent.change(textarea, { target: { value: longText } });

    expect(textarea.value.length).toBeLessThanOrEqual(2000);
  });

  it('disables textarea and send button when disabled prop is true', () => {
    render(<MessageInput onSend={vi.fn()} disabled={true} />);
    const textarea = screen.getByLabelText('Message input');
    const button = screen.getByLabelText('Send message');

    expect(textarea).toBeDisabled();
    expect(button).toBeDisabled();
  });

  it('does not submit when disabled', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={true} />);
    const textarea = screen.getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends trimmed value when submitting', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: '  Hello world  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Hello world');
  });

  it('send button is disabled when input is empty', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);
    const button = screen.getByLabelText('Send message');
    expect(button).toBeDisabled();
  });

  it('send button submits on click when input has content', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');
    const button = screen.getByLabelText('Send message');

    fireEvent.change(textarea, { target: { value: 'Click send' } });
    fireEvent.click(button);

    expect(onSend).toHaveBeenCalledWith('Click send');
  });

  it('textarea is a textarea element for multi-line support', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('textarea auto-focuses on mount', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByLabelText('Message input');
    expect(document.activeElement).toBe(textarea);
  });
});
