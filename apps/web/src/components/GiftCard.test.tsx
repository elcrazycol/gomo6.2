import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GiftCard } from './GiftCard';
import type { GiftCatalogItem, UserGiftItem } from './GiftCard';

vi.mock('@/utils/storage', () => ({
  storageUrl: (_bucket: string, key: string) => key ? `https://example.com/${key}` : null,
}));

vi.mock('date-fns', () => ({
  formatDistanceToNow: () => '2 дня назад',
}));

vi.mock('date-fns/locale', () => ({
  ru: {},
}));

const catalogGift: GiftCatalogItem = {
  id: 'gift-1',
  name: 'Розовый единорог',
  description: 'Милый подарок',
  image_url: 'gifts/unicorn.png',
  price: 100,
  category: 'animals',
  is_active: true,
  is_limited: false,
  max_quantity: 0,
  sold_count: 5,
  sort_order: 1,
};

const userGift: UserGiftItem = {
  id: 'ug-1',
  gift_id: 'gift-1',
  sender_id: 'user-1',
  recipient_id: 'user-2',
  message: 'С днём рождения!',
  is_anonymous: false,
  created_at: '2025-06-18T12:00:00Z',
  gift_name: 'Розовый единорог',
  gift_image_url: 'gifts/unicorn.png',
  gift_price: 100,
  sender_username: 'alice',
};

describe('GiftCard', () => {
  describe('catalog variant', () => {
    it('renders gift name', () => {
      render(<GiftCard gift={catalogGift} />);
      expect(screen.getByText('Розовый единорог')).toBeTruthy();
    });

    it('renders price with drops label', () => {
      render(<GiftCard gift={catalogGift} />);
      expect(screen.getByText(/100/)).toBeTruthy();
    });

    it('renders Limited badge when is_limited', () => {
      const limitedGift = { ...catalogGift, is_limited: true };
      render(<GiftCard gift={limitedGift} />);
      expect(screen.getByText('·Limited')).toBeTruthy();
    });

    it('does not render Limited badge when not limited', () => {
      render(<GiftCard gift={catalogGift} />);
      expect(screen.queryByText('·Limited')).toBeNull();
    });

    it('calls onSend when button clicked', () => {
      const onSend = vi.fn();
      render(<GiftCard gift={catalogGift} onSend={onSend} />);
      fireEvent.click(screen.getByText('Отправить'));
      expect(onSend).toHaveBeenCalledWith(catalogGift);
    });

    it('does not render send button without onSend', () => {
      render(<GiftCard gift={catalogGift} />);
      expect(screen.queryByText('Отправить')).toBeNull();
    });
  });

  describe('received variant', () => {
    it('renders gift name', () => {
      render(<GiftCard gift={userGift} variant="received" />);
      expect(screen.getByText('Розовый единорог')).toBeTruthy();
    });

    it('renders sender username', () => {
      render(<GiftCard gift={userGift} variant="received" />);
      expect(screen.getByText('@alice')).toBeTruthy();
    });

    it('renders Аноним for anonymous gifts', () => {
      const anonGift = { ...userGift, is_anonymous: true };
      render(<GiftCard gift={anonGift} variant="received" />);
      expect(screen.getByText('Аноним')).toBeTruthy();
    });

    it('renders message when present', () => {
      render(<GiftCard gift={userGift} variant="received" />);
      expect(screen.getByText(/С днём рождения/)).toBeTruthy();
    });

    it('does not render send button', () => {
      render(<GiftCard gift={userGift} variant="received" />);
      expect(screen.queryByText('Отправить')).toBeNull();
    });
  });
});
