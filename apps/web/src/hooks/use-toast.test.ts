import { describe, it, expect } from 'vitest';
import { reducer } from './use-toast';

type ToasterToast = {
  id: string;
  title?: string;
  description?: string;
  open?: boolean;
  [key: string]: unknown;
};

const makeState = (toasts: ToasterToast[] = []) => ({ toasts });

const makeToast = (id: string, overrides: Partial<ToasterToast> = {}): ToasterToast => ({
  id,
  title: `Toast ${id}`,
  open: true,
  ...overrides,
});

describe('toast reducer', () => {
  describe('ADD_TOAST', () => {
    it('adds a toast to empty state', () => {
      const state = reducer(makeState(), { type: 'ADD_TOAST', toast: makeToast('1') });
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0].id).toBe('1');
    });

    it('adds toast at the beginning, respecting TOAST_LIMIT', () => {
      const state = reducer(makeState([makeToast('1')]), { type: 'ADD_TOAST', toast: makeToast('2') });
      expect(state.toasts[0].id).toBe('2');
      expect(state.toasts).toHaveLength(1);
    });

    it('limits toasts to TOAST_LIMIT (1)', () => {
      const state = reducer(makeState([makeToast('1')]), { type: 'ADD_TOAST', toast: makeToast('2') });
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0].id).toBe('2');
    });
  });

  describe('UPDATE_TOAST', () => {
    it('updates matching toast', () => {
      const state = reducer(
        makeState([makeToast('1', { title: 'Old' })]),
        { type: 'UPDATE_TOAST', toast: { id: '1', title: 'New' } },
      );
      expect(state.toasts[0].title).toBe('New');
    });

    it('does not update non-matching toast', () => {
      const state = reducer(
        makeState([makeToast('1', { title: 'A' }), makeToast('2', { title: 'B' })]),
        { type: 'UPDATE_TOAST', toast: { id: '1', title: 'Updated' } },
      );
      expect(state.toasts[0].title).toBe('Updated');
      expect(state.toasts[1].title).toBe('B');
    });
  });

  describe('REMOVE_TOAST', () => {
    it('removes specific toast', () => {
      const state = reducer(
        makeState([makeToast('1'), makeToast('2')]),
        { type: 'REMOVE_TOAST', toastId: '1' },
      );
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0].id).toBe('2');
    });

    it('removes all toasts when no id given', () => {
      const state = reducer(
        makeState([makeToast('1'), makeToast('2')]),
        { type: 'REMOVE_TOAST' },
      );
      expect(state.toasts).toHaveLength(0);
    });
  });

  describe('DISMISS_TOAST', () => {
    it('sets open to false for matching toast', () => {
      const state = reducer(
        makeState([makeToast('1', { open: true })]),
        { type: 'DISMISS_TOAST', toastId: '1' },
      );
      expect(state.toasts[0].open).toBe(false);
    });

    it('dismisses all toasts when no id given', () => {
      const state = reducer(
        makeState([makeToast('1', { open: true }), makeToast('2', { open: true })]),
        { type: 'DISMISS_TOAST' },
      );
      expect(state.toasts.every((t) => t.open === false)).toBe(true);
    });
  });
});
