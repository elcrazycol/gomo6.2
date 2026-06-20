import { describe, it, expect } from 'vitest';

// Re-implementing pure geometry functions from AvatarCropper.tsx for testing
// These are internal to the component but the logic is worth verifying

type Point = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getDistance = (a: Point, b: Point) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const computeBaseScale = (naturalWidth: number, naturalHeight: number, frameSize: number) => {
  if (!naturalWidth || !naturalHeight || !frameSize) return 1;
  return Math.max(frameSize / naturalWidth, frameSize / naturalHeight);
};

const computeMaxOffset = (naturalWidth: number, naturalHeight: number, imageScale: number, frameSize: number) => {
  if (!naturalWidth || !naturalHeight) return { x: 0, y: 0 };
  return {
    x: Math.max(0, (naturalWidth * imageScale - frameSize) / 2),
    y: Math.max(0, (naturalHeight * imageScale - frameSize) / 2),
  };
};

const clampOffset = (next: Point, max: Point) => ({
  x: clamp(next.x, -max.x, max.x),
  y: clamp(next.y, -max.y, max.y),
});

describe('AvatarCropper geometry', () => {
  describe('clamp', () => {
    it('returns value within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('clamps to min', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('clamps to max', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('handles equal min and max', () => {
      expect(clamp(5, 3, 3)).toBe(3);
    });

    it('handles negative range', () => {
      expect(clamp(0, -10, -5)).toBe(-5);
    });

    it('handles zero', () => {
      expect(clamp(0, 0, 10)).toBe(0);
    });
  });

  describe('getDistance', () => {
    it('returns 0 for same point', () => {
      expect(getDistance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
    });

    it('computes horizontal distance', () => {
      expect(getDistance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
    });

    it('computes vertical distance', () => {
      expect(getDistance({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4);
    });

    it('computes diagonal distance', () => {
      expect(getDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it('handles negative coordinates', () => {
      expect(getDistance({ x: -3, y: -4 }, { x: 0, y: 0 })).toBe(5);
    });
  });

  describe('computeBaseScale', () => {
    it('returns 1 for zero dimensions', () => {
      expect(computeBaseScale(0, 0, 280)).toBe(1);
      expect(computeBaseScale(100, 0, 280)).toBe(1);
    });

    it('returns 1 for zero frame size', () => {
      expect(computeBaseScale(100, 100, 0)).toBe(1);
    });

    it('scales up small image to fill frame', () => {
      // 50x50 image in 280x280 frame → scale = 5.6
      expect(computeBaseScale(50, 50, 280)).toBe(280 / 50);
    });

    it('scales down large image to fit frame', () => {
      // 1000x500 image in 280x280 frame → max(0.28, 0.56) = 0.56
      const scale = computeBaseScale(1000, 500, 280);
      expect(scale).toBeCloseTo(280 / 500);
    });

    it('uses wider dimension for non-square images', () => {
      // 1000x200 image in 280 frame → max(0.28, 1.4) = 1.4
      const scale = computeBaseScale(1000, 200, 280);
      expect(scale).toBeCloseTo(280 / 200);
    });
  });

  describe('computeMaxOffset', () => {
    it('returns 0 for zero dimensions', () => {
      const offset = computeMaxOffset(0, 0, 1, 280);
      expect(offset).toEqual({ x: 0, y: 0 });
    });

    it('returns 0 when image exactly fits frame', () => {
      // 280x280 image at scale 1 in 280 frame → (280*1-280)/2 = 0
      const offset = computeMaxOffset(280, 280, 1, 280);
      expect(offset).toEqual({ x: 0, y: 0 });
    });

    it('allows panning when image is larger than frame', () => {
      // 560x560 image at scale 1 in 280 frame → (560-280)/2 = 140
      const offset = computeMaxOffset(560, 560, 1, 280);
      expect(offset).toEqual({ x: 140, y: 140 });
    });

    it('handles non-square images', () => {
      // 800x400 at scale 1 in 280 frame
      const offset = computeMaxOffset(800, 400, 1, 280);
      expect(offset.x).toBeCloseTo((800 - 280) / 2);
      expect(offset.y).toBeCloseTo((400 - 280) / 2);
    });
  });

  describe('clampOffset', () => {
    it('allows offset within bounds', () => {
      const max = { x: 100, y: 100 };
      expect(clampOffset({ x: 50, y: 50 }, max)).toEqual({ x: 50, y: 50 });
    });

    it('clamps positive offset to max', () => {
      const max = { x: 100, y: 100 };
      expect(clampOffset({ x: 150, y: 150 }, max)).toEqual({ x: 100, y: 100 });
    });

    it('clamps negative offset to -max', () => {
      const max = { x: 100, y: 100 };
      expect(clampOffset({ x: -150, y: -150 }, max)).toEqual({ x: -100, y: -100 });
    });

    it('allows zero offset', () => {
      const max = { x: 100, y: 100 };
      expect(clampOffset({ x: 0, y: 0 }, max)).toEqual({ x: 0, y: 0 });
    });
  });
});
