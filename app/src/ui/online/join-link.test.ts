import { describe, expect, it } from 'vitest';
import { joinCodeIn, joinLink } from './join-link';

describe('join links', () => {
  it('make a link to this page with the room code', () => {
    expect(joinLink('ABCDE', { origin: 'https://almapeterson.github.io', pathname: '/build-that-wall/' }))
      .toBe('https://almapeterson.github.io/build-that-wall/?join=ABCDE');
  });

  it('read the code back, tidied, and ignore anything that is not a room code', () => {
    expect(joinCodeIn('?join=abcde')).toBe('ABCDE');
    expect(joinCodeIn('?x=1&join=GQ7ZK2')).toBe('GQ7ZK2');
    expect(joinCodeIn('?join=<script>')).toBeNull();
    expect(joinCodeIn('?join=AB')).toBeNull();
    expect(joinCodeIn('')).toBeNull();
  });
});
