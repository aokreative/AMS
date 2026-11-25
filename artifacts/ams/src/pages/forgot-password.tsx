import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandLockup } from '@/components/BrandLockup';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle, MailCheck } from 'lucide-react';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      // Rate limits and network failures are worth showing; an unknown email is not
      // reported by Supabase, so nobody can probe which addresses have accounts.
      setError(
        resetError.message.toLowerCase().includes('rate limit')
          ? t('workspace.forgot.rateLimit')
          : resetError.message || t('workspace.forgot.failed'),
      );
      return;
    }
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <BrandLockup />
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-2xl font-bold tracking-tight text-center">{t('workspace.forgot.title')}</CardTitle>
            <CardDescription className="text-center">
              {sent ? t('workspace.forgot.descSent') : t('workspace.forgot.desc')}
            </CardDescription>
          </CardHeader>

          {sent ? (
            <>
              <CardContent>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted text-sm">
                  <MailCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                  <span>
                    <Trans i18nKey="workspace.forgot.sent" values={{ email: email.trim() }} components={{ b: <strong /> }} />
                  </span>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-3 pt-4">
                <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                  {t('workspace.forgot.differentEmail')}
                </Button>
                <a href="/login" className="text-xs text-primary font-medium hover:underline">
                  {t('workspace.forgot.backToSignIn')}
                </a>
              </CardFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
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
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    required
                    disabled={loading}
                    autoComplete="email"
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-3 pt-4">
                <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
                  {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('workspace.forgot.send')}
                </Button>
                <a href="/login" className="text-xs text-primary font-medium hover:underline">
                  {t('workspace.forgot.backToSignIn')}
                </a>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
