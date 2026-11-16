export const MIN_PASSWORD_LENGTH = 8;

/** Pages a signed-out visitor may stay on (the auth context does not bounce them to /login). */
const PUBLIC_AUTH_PATHS = ['/login', '/register', '/join', '/forgot-password', '/reset-password', '/privacy', '/terms'];

export function isPublicAuthPath(path: string): boolean {
  return PUBLIC_AUTH_PATHS.includes(path);
}

/** Validation for choosing a new password; null when it is acceptable. */
export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The passwords don't match.";
  return null;
}

/** What happened after supabase.auth.signUp. */
export function signUpOutcome(data: {
  user?: { identities?: unknown[] | null } | null;
  session?: unknown | null;
}): 'signed_in' | 'verify' | 'exists' {
  if (data.session) return 'signed_in';
  // Supabase hides an already-registered email by returning a user with no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return 'exists';
  return 'verify';
}

export function isEmailNotConfirmed(message: string | null | undefined): boolean {
  return /email not confirmed/i.test(message ?? '');
}

/** Digits only, at most 8 (Supabase email codes are 6 by default, configurable up to 8). */
export function cleanCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 8);
}

export function isCompleteCode(code: string): boolean {
  return /^\d{6,8}$/.test(code);
}
