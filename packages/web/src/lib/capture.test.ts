import { describe, expect, it } from 'vitest';
import { displayMediaVideoConstraints, downscaleFactor } from './capture';

describe('displayMediaVideoConstraints', () => {
  it('limita a captura a 1920x1080 e pede 30 fps', () => {
    expect(displayMediaVideoConstraints()).toEqual({
      frameRate: { ideal: 30 },
      width: { max: 1920 },
      height: { max: 1080 },
    });
  });
});

describe('downscaleFactor', () => {
  it('telas que já cabem em 1080p não são reduzidas (nunca amplia)', () => {
    expect(downscaleFactor(1920, 1080)).toBe(1);
    expect(downscaleFactor(1366, 768)).toBe(1);
    expect(downscaleFactor(1280, 720)).toBe(1);
  });

  it('1440p e 4K viram 1080p mantendo a proporção', () => {
    expect(downscaleFactor(2560, 1440)).toBeCloseTo(1.3333, 4);
    expect(downscaleFactor(3840, 2160)).toBe(2);
  });

  it('ultrawide: o lado que mais passa do limite manda', () => {
    expect(downscaleFactor(3440, 1440)).toBeCloseTo(3440 / 1920, 4); // 1.79: largura
    expect(downscaleFactor(1920, 1200)).toBeCloseTo(1200 / 1080, 4); // 16:10: altura
  });

  it('sem dimensões válidas não mexe', () => {
    expect(downscaleFactor(undefined, undefined)).toBe(1);
    expect(downscaleFactor(0, 1080)).toBe(1);
    expect(downscaleFactor(1920, -1)).toBe(1);
  });
});
