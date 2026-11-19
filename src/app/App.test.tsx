import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom has no scrolling implementation for Radix's focused option.
HTMLElement.prototype.scrollIntoView = vi.fn();

describe('sample mailbox', () => {
  it('selects a message and displays its plain text', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /notes from our design review/i }));

    const reader = screen.getByRole('main', { name: 'Message reader' });
    expect(within(reader).getByRole('heading', { name: 'Notes from our design review' })).toBeTruthy();
    expect(within(reader).getByText(/decisions from this morning/)).toBeTruthy();
  });

  it('filters messages within the current folder and clears search when switching folders', () => {
    render(<App />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'weekend' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Weekend plans' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('heading', { name: 'Travel itinerary' })).toBeTruthy();
    expect((screen.getByRole<HTMLInputElement>('searchbox')).value).toBe('');
  });

  it('updates the appearance through the keyboard-accessible selector', async () => {
    render(<App />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Appearance' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Dark' }), { key: 'Enter' });
    expect(screen.getByRole('main').closest('[data-theme]')?.getAttribute('data-theme')).toBe('dark');
  });

  it('moves focus into the narrow reader and restores it on return', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<App />);

    const message = screen.getByRole('button', { name: /notes from our design review/i });
    fireEvent.click(message);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Notes from our design review' }));

    fireEvent.click(screen.getByRole('button', { name: 'Back to messages' }));
    expect(document.activeElement).toBe(message);
  });
});
