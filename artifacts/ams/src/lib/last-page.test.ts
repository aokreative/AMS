import { describe, expect, it } from 'vitest';
import { lastPage, notePage } from './last-page';

describe('lastPage', () => {
  it('remembers the last non-legal page', () => {
    expect(lastPage()).toBeNull();
    notePage('/register');
    notePage('/terms');
    notePage('/privacy');
    expect(lastPage()).toBe('/register');
    notePage('/dashboard');
    expect(lastPage()).toBe('/dashboard');
  });
});
