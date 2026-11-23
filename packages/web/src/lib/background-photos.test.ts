import { describe, expect, it } from 'vitest';
import { BACKGROUND_PHOTOS } from './background-photos';

describe('BACKGROUND_PHOTOS', () => {
  it('são nove fotos, uma de cada, sem repetir arquivo nem posição', () => {
    expect(BACKGROUND_PHOTOS).toHaveLength(9);
    expect(new Set(BACKGROUND_PHOTOS.map((p) => p.src)).size).toBe(9);
    expect(new Set(BACKGROUND_PHOTOS.map((p) => p.className)).size).toBe(9);
  });

  it('todas vêm de /fotos/ e têm uma classe de posição numerada', () => {
    for (const photo of BACKGROUND_PHOTOS) {
      expect(photo.src).toMatch(/^\/fotos\/guri-\d\.(jpg|webp)$/);
      expect(photo.className).toMatch(/^bg-photo-\d$/);
    }
  });
});
