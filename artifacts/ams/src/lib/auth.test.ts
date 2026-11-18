import { describe, expect, it } from 'vitest';
import { cleanCode, isCompleteCode, isEmailNotConfirmed, isPublicAuthPath, joinNextStep, needsAgencySetup, newPasswordError, registerNextStep, signUpOutcome } from './auth';

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
    expect(isPublicAuthPath('/demo')).toBe(true);
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

describe('registerNextStep', () => {
  const base = { signedIn: true, hasProfile: false, busy: false, step: 'form' as const };
  it('signed-out visitors stay on the form', () => {
    expect(registerNextStep({ ...base, signedIn: false })).toBeNull();
  });
  it('signed in without an agency: name the agency', () => {
    expect(registerNextStep(base)).toBe('finish');
  });
  it('signed in with an agency: go to the app', () => {
    expect(registerNextStep({ ...base, hasProfile: true })).toBe('dashboard');
  });
  it('waits while a request is running or the code step is creating the agency', () => {
    expect(registerNextStep({ ...base, busy: true })).toBeNull();
    expect(registerNextStep({ ...base, step: 'code' })).toBeNull();
  });
});

describe('needsAgencySetup', () => {
  it('signed in, profile fetched, no profile: send to /register', () => {
    expect(needsAgencySetup('u1', 'u1', false)).toBe(true);
  });
  it('not yet fetched for this user: wait (no flash of /register)', () => {
    expect(needsAgencySetup('u1', null, false)).toBe(false);
    expect(needsAgencySetup('u1', 'u0', false)).toBe(false);
  });
  it('has a profile: fine', () => {
    expect(needsAgencySetup('u1', 'u1', true)).toBe(false);
  });
});

describe('joinNextStep', () => {
  it('signed in straight away: accept the invite', () => {
    expect(joinNextStep({ outcome: 'signed_in' })).toBe('accept');
  });
  it('email needs confirming: ask for the code', () => {
    expect(joinNextStep({ outcome: 'verify' })).toBe('code');
  });
  it('email already registered: try their password', () => {
    expect(joinNextStep({ outcome: 'exists' })).toBe('signin');
  });
  it('sign-in refused because the email is unconfirmed: ask for the code', () => {
    expect(joinNextStep({ signInError: 'Email not confirmed' })).toBe('code');
  });
  it('any other sign-in error is shown', () => {
    expect(joinNextStep({ signInError: 'Invalid login credentials' })).toBe('error');
  });
  it('signed in without error: accept', () => {
    expect(joinNextStep({ signInError: null })).toBe('accept');
  });
});
