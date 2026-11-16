import { describe, expect, it } from 'vitest';
import { cleanCode, isCompleteCode, isEmailNotConfirmed, isPublicAuthPath, newPasswordError, signUpOutcome } from './auth';

describe('newPasswordError', () => {
  it('needs at least 8 characters', () => {
    expect(newPasswordError('short', 'short')).toBe('Password must be at least 8 characters.');
  });
  it('needs both entries to match', () => {
    expect(newPasswordError('longenough1', 'longenough2')).toBe("The passwords don't match.");
  });
  it('accepts a valid matching password', () => {
    expect(newPasswordError('longenough1', 'longenough1')).toBeNull();
  });
});

describe('isPublicAuthPath', () => {
  it('sign-in pages, including password reset, are public', () => {
    for (const p of ['/login', '/register', '/join', '/forgot-password', '/reset-password']) {
      expect(isPublicAuthPath(p)).toBe(true);
    }
  });
  it('the privacy notice and terms are public', () => {
    expect(isPublicAuthPath('/privacy')).toBe(true);
    expect(isPublicAuthPath('/terms')).toBe(true);
  });
  it('app pages are not', () => {
    expect(isPublicAuthPath('/dashboard')).toBe(false);
  });
});

describe('signUpOutcome', () => {
  it('signed straight in when Supabase returns a session', () => {
    expect(signUpOutcome({ user: { identities: [{}] }, session: {} })).toBe('signed_in');
  });
  it('needs the email code when there is a user but no session', () => {
    expect(signUpOutcome({ user: { identities: [{}] }, session: null })).toBe('verify');
  });
  it('already registered when Supabase hides the user (no identities)', () => {
    expect(signUpOutcome({ user: { identities: [] }, session: null })).toBe('exists');
  });
});

describe('isEmailNotConfirmed', () => {
  it('spots the unconfirmed sign-in error', () => {
    expect(isEmailNotConfirmed('Email not confirmed')).toBe(true);
    expect(isEmailNotConfirmed('Invalid login credentials')).toBe(false);
  });
});

describe('cleanCode', () => {
  it('keeps digits only, up to 8', () => {
    expect(cleanCode(' 12 34-56 ')).toBe('123456');
    expect(cleanCode('1234567890')).toBe('12345678');
  });
  it('a code is complete at 6 digits', () => {
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('123456')).toBe(true);
  });
});
