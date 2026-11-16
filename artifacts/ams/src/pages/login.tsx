import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandLockup } from '@/components/BrandLockup';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isEmailNotConfirmed } from '@/lib/auth';
import { VerifyEmailCode } from '@/components/VerifyEmailCode';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const [needsCode, setNeedsCode] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        // Give friendly, specific messages
        if (signInError.message.toLowerCase().includes('invalid login credentials') ||
            signInError.message.toLowerCase().includes('invalid credentials')) {
          throw new Error('Incorrect email or password. Double-check and try again.');
        }
        if (isEmailNotConfirmed(signInError.message)) {
          // Not confirmed yet: send a fresh code and ask for it here.
          setNeedsCode(true);
          return;
        }
        if (signInError.message.toLowerCase().includes('fetch') ||
            signInError.message.toLowerCase().includes('network') ||
            signInError.message.toLowerCase().includes('failed')) {
          throw new Error(
            'Could not reach the database. Check that your Supabase project is active (it may be paused on the free tier) and that your URL/key secrets are correct.'
          );
        }
        throw signInError;
      }

      setLocation('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <BrandLockup />
        </div>

        <Card className="border-border/50 shadow-xl">
          {needsCode ? (
            <VerifyEmailCode
              email={email.trim()}
              sendOnMount
              onVerified={() => setLocation('/register')}
              onChangeEmail={() => setNeedsCode(false)}
            />
          ) : (<>
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-2xl font-bold tracking-tight text-center">{t('auth.signInTitle')}</CardTitle>
            <CardDescription className="text-center">
              {t('auth.signInSubtitle')}
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">{t('common.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="agent@brokerage.co.ke"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null); }}
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t('common.password')}</Label>
                  <a href="/forgot-password" className="text-xs text-primary font-medium hover:underline">
                    {t('auth.forgotPassword')}
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null); }}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>
            </CardContent>

            <CardFooter className="flex flex-col space-y-3 pt-4">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t('auth.signIn')}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                {t('auth.noAccount')}{' '}
                <a href="/register" className="text-primary font-medium hover:underline">
                  {t('auth.createAgency')}
                </a>
              </p>
            </CardFooter>
          </form>
          </>)}
        </Card>
        <div className="mx-auto mt-4 w-48">
          <LanguageSwitcher />
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <a href="/privacy" className="hover:underline">{t('auth.privacyLink')}</a>
          <span className="mx-2">·</span>
          <a href="/terms" className="hover:underline">{t('auth.termsLink')}</a>
        </p>
      </div>
    </div>
  );
}
