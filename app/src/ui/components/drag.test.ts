import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, clampOffset, scaleFor } from './drag';

describe('clampOffset', () => {
  const box = { left: 300, top: 200, right: 500, bottom: 400 };   // 200 × 200, at offset 0, in a 1000 × 800 window
  const win = { left: 0, top: 0, right: 1000, bottom: 800 };
  it('moves freely inside the window', () => {
    expect(clampOffset({ x: -100, y: 50 }, { x: 0, y: 0 }, box, win)).toEqual({ x: -100, y: 50 });
  });
  it('keeps 48px of the box on screen, and its top edge never above the window', () => {
    expect(clampOffset({ x: -2000, y: -2000 }, { x: 0, y: 0 }, box, win)).toEqual({ x: -452, y: -200 });
    expect(clampOffset({ x: 2000, y: 2000 }, { x: 0, y: 0 }, box, win)).toEqual({ x: 652, y: 552 });
  });
  it('stays inside a smaller area (the board)', () => {
    expect(clampOffset({ x: 0, y: 2000 }, { x: 0, y: 0 }, box, { left: 0, top: 100, right: 1000, bottom: 600 })).toEqual({ x: 0, y: 352 });
    expect(clampOffset({ x: 0, y: -2000 }, { x: 0, y: 0 }, box, { left: 0, top: 100, right: 1000, bottom: 600 })).toEqual({ x: 0, y: -100 });
  });
  it('works from where the box already was', () => {
    expect(clampOffset({ x: 2000, y: 0 }, { x: 100, y: 0 }, box, win)).toEqual({ x: 752, y: 0 });
  });
});

describe('scaleFor', () => {
  const corner = { x: 100, y: 100 }, grip = { x: 300, y: 300 };     // the grip is 200, 200 from the top-left corner
  it('the grip follows the pointer: halfway in is half size', () => {
    expect(scaleFor(1, corner, grip, -100, -100)).toBe(0.5);
    expect(scaleFor(1, corner, grip, 40, 40)).toBe(1.2);
  });
  it('scales from the current size', () => {
    expect(scaleFor(0.5, corner, grip, 200, 200)).toBe(1);
  });
  it('stays between the smallest and biggest sizes', () => {
    expect(scaleFor(1, corner, grip, -1000, -1000)).toBe(MIN_SCALE);
    expect(scaleFor(1, corner, grip, 1000, 1000)).toBe(MAX_SCALE);
  });
});
