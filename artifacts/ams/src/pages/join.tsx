import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '@/components/PasswordInput';
import { Link, useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandLockup } from '@/components/BrandLockup';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';
import { TermsConsent } from '@/components/TermsConsent';
import { VerifyEmailCode } from '@/components/VerifyEmailCode';
import { joinNextStep, signUpOutcome } from '@/lib/auth';

interface InvitePreview {
  agency_name: string;
  role: string;
  email: string;
}

// Marker for "show the invalid-link message"; the text itself is translated where it is shown.
const INVALID_LINK = 'invalid';

function capitalise(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <BrandLockup />
        </div>
        <Card className="border-border/50 shadow-xl">{children}</Card>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export default function Join() {
  const { t } = useTranslation();
  const code = new URLSearchParams(window.location.search).get('code');
  const { session, profile, isLoading: authLoading, refreshProfile } = useAuth();
  const [, setLocation] = useLocation();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  // Email confirmation is on: after sign-up the person types the code we emailed.
  const [codeStep, setCodeStep] = useState<null | { resend: boolean }>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!code) {
        setPreviewError(INVALID_LINK);
        setPreviewLoading(false);
        return;
      }
      const { data, error: rpcError } = await supabase.rpc('get_invite_preview', { p_code: code });
      if (cancelled) return;
      if (rpcError || !data) {
        setPreviewError(INVALID_LINK);
      } else {
        const row = (Array.isArray(data) ? data[0] : data) as InvitePreview | undefined;
        if (row) setPreview(row);
        else setPreviewError(INVALID_LINK);
      }
      setPreviewLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const accept = async () => {
    const { error: rpcError } = await supabase.rpc('accept_invite', {
      p_code: code,
      p_full_name: fullName.trim(),
      p_terms_accepted: true,
    });
    if (rpcError) throw new Error(rpcError.message);
    await refreshProfile();
    setLocation('/dashboard');
  };

  // Signed-in visitor with a matching email and no profile: just accept.
  const handleAcceptSignedIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!agreed) {
      setError(t('auth.termsRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await accept();
    } catch (err: any) {
      setError(err.message || t('workspace.join.genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  // Signed-out visitor: sign up (or sign in), then accept.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !preview) return;
    setError(null);

    if (!fullName.trim()) {
      setError(t('workspace.join.enterName'));
      return;
    }
    if (!agreed) {
      setError(t('auth.termsRequired'));
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError(t('workspace.join.passwordTooShort'));
      return;
    }
    if (mode === 'signin' && !password) {
      setError(t('workspace.join.enterPassword'));
      return;
    }

    setSubmitting(true);
    const email = preview.email;
    try {
      let step: ReturnType<typeof joinNextStep>;
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        step = joinNextStep({ signInError: signInError?.message ?? null });
        if (step === 'error') throw new Error(signInError!.message);
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) {
          const msg = signUpError.message.toLowerCase();
          if (!msg.includes('already registered')) throw new Error(signUpError.message);
          step = 'signin';
        } else {
          step = joinNextStep({ outcome: signUpOutcome(data) });
        }
        if (step === 'signin') {
          // The email already has an account: try the password they typed.
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          step = joinNextStep({ signInError: signInError?.message ?? null });
          if (step === 'error') {
            throw new Error(t('workspace.join.accountExists'));
          }
        }
      }
      if (step === 'code') {
        // From sign-in an unconfirmed account needs a fresh code; sign-up has just sent one.
        setCodeStep({ resend: mode === 'signin' });
        return;
      }
      await accept();
    } catch (err: any) {
      setError(err.message || t('workspace.join.genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setError(null);
    // Use supabase directly so we stay on /join (context signOut redirects to /login).
    await supabase.auth.signOut();
  };

  if (previewLoading || authLoading) {
    return (
      <Shell>
        <CardContent className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Shell>
    );
  }

  if (previewError || !preview) {
    return (
      <Shell>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight text-center">{t('workspace.join.unavailable')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorBox message={t('workspace.join.invalidLink')} />
        </CardContent>
        <CardFooter>
          <p className="text-sm text-center text-muted-foreground w-full">
            <Link href="/login" className="text-primary font-medium hover:underline">
              {t('workspace.join.goSignIn')}
            </Link>
          </p>
        </CardFooter>
      </Shell>
    );
  }

  const roleLabel = t(`roles.${preview.role}`, { defaultValue: capitalise(preview.role) });
  const header = (
    <CardHeader className="space-y-1 pb-6">
      <CardTitle className="text-2xl font-bold tracking-tight text-center">{t('workspace.join.title', { agency: preview.agency_name })}</CardTitle>
      <CardDescription className="text-center">{t('workspace.join.invitedAs', { role: roleLabel })}</CardDescription>
    </CardHeader>
  );

  // Email-code step: once the code is right the person is signed in and joins straight away.
  if (codeStep) {
    return (
      <Shell>
        {error && (
          <CardContent className="pt-6">
            <ErrorBox message={error} />
          </CardContent>
        )}
        <VerifyEmailCode
          email={preview.email}
          sendOnMount={codeStep.resend}
          onVerified={async () => {
            setError(null);
            setSubmitting(true);
            try {
              await accept();
            } catch (err: any) {
              setError(err.message || t('workspace.join.genericError'));
              setCodeStep(null);
            } finally {
              setSubmitting(false);
            }
          }}
        />
      </Shell>
    );
  }

  // Keep the form on screen while a submit is in flight, even though the session appears mid-way.
  if (session && !submitting) {
    if (profile) {
      return (
        <Shell>
          {header}
          <CardContent className="space-y-4">
            <p className="text-sm text-center">{t('workspace.join.alreadyBelongs')}</p>
          </CardContent>
          <CardFooter>
            <Button asChild className="w-full">
              <Link href="/dashboard">{t('workspace.join.goDashboard')}</Link>
            </Button>
          </CardFooter>
        </Shell>
      );
    }

    if (session.email.toLowerCase() !== preview.email.toLowerCase()) {
      return (
        <Shell>
          {header}
          <CardContent className="space-y-4">
            {error && <ErrorBox message={error} />}
            <p className="text-sm text-center">
              {t('workspace.join.signedInAs', { email: session.email })}
            </p>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={() => { void handleSignOut(); }}>
              {t('common.signOut')}
            </Button>
          </CardFooter>
        </Shell>
      );
    }

    return (
      <Shell>
        {header}
        <form onSubmit={handleAcceptSignedIn}>
          <CardContent className="space-y-4">
            {error && <ErrorBox message={error} />}
            <div className="space-y-2">
              <Label htmlFor="email">{t('common.email')}</Label>
              <Input id="email" type="email" value={preview.email} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">{t('common.fullName')}</Label>
              <Input
                id="fullName"
                placeholder="Jane Kamau"
                value={fullName}
                onChange={e => { setFullName(e.target.value); setError(null); }}
                required
                disabled={submitting}
                autoComplete="name"
              />
            </div>
            <TermsConsent checked={agreed} onChange={(v) => { setAgreed(v); setError(null); }} disabled={submitting} />
          </CardContent>
          <CardFooter className="pt-4">
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('workspace.join.joinAgency', { agency: preview.agency_name })}
            </Button>
          </CardFooter>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      {header}
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && <ErrorBox message={error} />}

          <div className="space-y-2">
            <Label htmlFor="email">{t('common.email')}</Label>
            <Input id="email" type="email" value={preview.email} disabled />
          </div>

          {(
            <div className="space-y-2">
              <Label htmlFor="fullName">{t('common.fullName')}</Label>
              <Input
                id="fullName"
                placeholder="Jane Kamau"
                value={fullName}
                onChange={e => { setFullName(e.target.value); setError(null); }}
                required
                disabled={submitting}
                autoComplete="name"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">{t('common.password')}</Label>
            <PasswordInput
              id="password"
              placeholder={mode === 'signup' ? t('auth.passwordHint') : t('workspace.join.passwordPlaceholderSignIn')}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null); }}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              disabled={submitting}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          <TermsConsent checked={agreed} onChange={(v) => { setAgreed(v); setError(null); }} disabled={submitting} />
        </CardContent>

        <CardFooter className="flex flex-col space-y-3 pt-4">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {submitting
              ? t('workspace.join.joining')
              : mode === 'signup'
                ? t('workspace.join.joinAgency', { agency: preview.agency_name })
                : t('workspace.join.signInAndJoin')}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            {mode === 'signup' ? t('auth.haveAccount') : t('workspace.join.newHere')}{' '}
            <button
              type="button"
              className="text-primary font-medium hover:underline"
              disabled={submitting}
              onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}
            >
              {mode === 'signup' ? t('workspace.join.signInInstead') : t('workspace.join.createAccount')}
            </button>
          </p>
        </CardFooter>
      </form>
    </Shell>
  );
}
