import React, { useEffect, useState } from 'react';
import { PasswordInput } from '@/components/PasswordInput';
import { Link, useLocation } from 'wouter';
import { AuthLegalLinks, DemoPromo } from '@/components/DemoPromo';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { signUpOutcome, isEmailNotConfirmed, registerNextStep } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandLockup } from '@/components/BrandLockup';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';
import { TermsConsent } from '@/components/TermsConsent';
import { VerifyEmailCode } from '@/components/VerifyEmailCode';

type Step = 'form' | 'code' | 'finish';

/**
 * Sign-up: details → 6-digit email code → agency created → /onboarding.
 * A signed-in visitor with no agency yet (e.g. verified from the sign-in
 * page) lands on the "finish" step to name the agency.
 */
export default function Register() {
  const { t } = useTranslation();
  const { session, profile, isLoading, refreshProfile } = useAuth();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>('form');
  const [agencyName, setAgencyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed in already: either finish creating the agency, or move on.
  useEffect(() => {
    if (isLoading) return;
    const next = registerNextStep({ signedIn: !!session, hasProfile: !!profile, busy: loading, step });
    if (next === null) return;
    if (next === 'dashboard') {
      setLocation('/dashboard');
      return;
    }
    if (step === 'finish') return;
    void supabase.auth.getUser().then(({ data }) => {
      const meta = (data.user?.user_metadata ?? {}) as { agency_name?: string; full_name?: string };
      setAgencyName((v) => v || meta.agency_name || '');
      setOwnerName((v) => v || meta.full_name || '');
      setStep('finish');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, session?.id, profile?.id, loading, step]);

  const createAgency = async () => {
    const { error: rpcError } = await supabase.rpc('create_agency_with_owner', {
      p_agency_name: agencyName.trim(),
      p_owner_name: ownerName.trim(),
      p_owner_phone: null,
      p_terms_accepted: true,
    });
    if (rpcError) throw new Error(rpcError.message);
    await refreshProfile();
    setLocation('/onboarding');
  };

  const run = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError(t('auth.termsRequired'));
      return;
    }
    void run(async () => {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { agency_name: agencyName.trim(), full_name: ownerName.trim() } },
      });
      if (signUpError) throw new Error(signUpError.message);

      const outcome = signUpOutcome(data);
      if (outcome === 'signed_in') {
        await createAgency();
      } else if (outcome === 'verify') {
        setStep('code');
      } else {
        // Already registered: try the password; an unconfirmed account goes to the code step.
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError && isEmailNotConfirmed(signInError.message)) {
          setStep('code');
          return;
        }
        if (signInError) throw new Error('An account with this email already exists. Sign in instead.');
        // Signed in: the effect above takes it from here.
      }
    });
  };

  const handleFinish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError(t('auth.termsRequired'));
      return;
    }
    void run(createAgency);
  };

  const errorBox = error && (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>{error}</span>
    </div>
  );

  const nameFields = (
    <>
      <div className="space-y-2">
        <Label htmlFor="agencyName">{t('auth.agencyName')}</Label>
        <Input id="agencyName" placeholder="Acme Insurance Brokers" value={agencyName}
          onChange={(e) => { setAgencyName(e.target.value); setError(null); }} required disabled={loading} autoComplete="organization" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ownerName">{t('common.fullName')}</Label>
        <Input id="ownerName" placeholder="Jane Kamau" value={ownerName}
          onChange={(e) => { setOwnerName(e.target.value); setError(null); }} required disabled={loading} autoComplete="name" />
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <BrandLockup />
        </div>

        <Card className="border-border/50 shadow-xl">
          {step === 'code' ? (
            <VerifyEmailCode
              email={email.trim()}
              onVerified={async () => {
                setLoading(true);
                try {
                  await createAgency();
                } finally {
                  setLoading(false);
                }
              }}
              onChangeEmail={() => { setStep('form'); setError(null); }}
            />
          ) : step === 'finish' ? (
            <form onSubmit={handleFinish}>
              <CardHeader className="space-y-1 pb-6">
                <CardTitle className="text-2xl font-bold tracking-tight text-center">{t('auth.registerTitle')}</CardTitle>
                <CardDescription className="text-center">{session?.email}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {errorBox}
                {nameFields}
                <TermsConsent checked={agreed} onChange={(v) => { setAgreed(v); setError(null); }} disabled={loading} />
              </CardContent>
              <CardFooter className="pt-4">
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {loading ? t('auth.creating') : t('common.continue')}
                </Button>
              </CardFooter>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <CardHeader className="space-y-1 pb-6">
                <CardTitle className="text-2xl font-bold tracking-tight text-center">{t('auth.registerTitle')}</CardTitle>
                <CardDescription className="text-center">{t('auth.registerSubtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {errorBox}
                {nameFields}
                <div className="space-y-2">
                  <Label htmlFor="email">{t('common.email')}</Label>
                  <Input id="email" type="email" placeholder="jane@acmebrokers.co.ke" value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }} required disabled={loading} autoComplete="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t('common.password')}</Label>
                  <PasswordInput id="password" placeholder={t('auth.passwordHint')} value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }} required minLength={8} disabled={loading} autoComplete="new-password" />
                </div>
                <TermsConsent checked={agreed} onChange={(v) => { setAgreed(v); setError(null); }} disabled={loading} />
              </CardContent>
              <CardFooter className="flex flex-col space-y-3 pt-4">
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {loading ? t('auth.creating') : t('auth.createAccount')}
                </Button>
                <p className="text-sm text-center text-muted-foreground">
                  {t('auth.haveAccount')}{' '}
                  <Link href="/login" className="text-primary font-medium hover:underline">{t('auth.signIn')}</Link>
                </p>
              </CardFooter>
            </form>
          )}
        </Card>
        {step === 'form' && <DemoPromo />}
        <AuthLegalLinks />
      </div>
    </div>
  );
}
