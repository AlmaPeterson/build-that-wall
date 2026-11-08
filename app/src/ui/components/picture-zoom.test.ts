import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, NORMAL, panBy, pinchStep, wheelFactor, zoomAt } from './picture-zoom';

describe('picture zoom', () => {
  it('keeps the spot under the pointer still', () => {
    const v = zoomAt(NORMAL, 2, 0.8, 0.9);
    expect(v.z).toBe(2);
    // The pointer was 80% across the box; that point of the picture is still under it
    expect(v.x + 0.8 * v.z).toBeCloseTo(0.8);
    expect(v.y + 0.9 * v.z).toBeCloseTo(0.9);
  });

  it('never goes below normal size or past the most', () => {
    expect(zoomAt(NORMAL, 0.5, 0.5, 0.5)).toEqual(NORMAL);
    expect(zoomAt({ z: 4, x: -1, y: -1 }, 10, 0.5, 0.5).z).toBe(MAX_ZOOM);
  });

  it('the picture always covers its box when panned', () => {
    expect(panBy({ z: 2, x: -0.5, y: -0.5 }, 5, -5)).toEqual({ z: 2, x: 0, y: -1 });
  });

  it('wheel up zooms in, down zooms out', () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-99, 0));
  });

  it('pinching apart zooms in around the spot between the fingers', () => {
    const m = { x: 0.3, y: 0.6 };
    const v = pinchStep(NORMAL, m, 100, m, 200);
    expect(v.z).toBe(2);
    expect(v.x + 0.3 * v.z).toBeCloseTo(0.3);   // the picture under the fingers stays under them
    expect(v.y + 0.6 * v.z).toBeCloseTo(0.6);
  });

  it('pinching together zooms out, but not below normal', () => {
    expect(pinchStep({ z: 2, x: -0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, 200, { x: 0.5, y: 0.5 }, 100)).toEqual(NORMAL);
  });

  it('moving both fingers slides a zoomed picture with them', () => {
    const v = pinchStep({ z: 2, x: -0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, 100, { x: 0.6, y: 0.4 }, 100);
    expect(v.x).toBeCloseTo(-0.4);
    expect(v.y).toBeCloseTo(-0.6);
  });
});
