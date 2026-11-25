import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '@/components/PasswordInput';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandLockup } from '@/components/BrandLockup';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

type Status = 'checking' | 'ready' | 'invalid' | 'done';

/** Landing page of the emailed reset link: the link signs the user in, then they choose a new password. */
export default function ResetPassword() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // An expired or reused link comes back with an error in the URL instead of a session.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    if (hash.get('error') || query.get('error')) {
      setStatus('invalid');
      return;
    }

    let settled = false;
    const ready = () => {
      if (!settled) {
        settled = true;
        setStatus('ready');
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) ready();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) ready();
    });
    // The client reads the link's token as it starts; give it a moment before giving up.
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setStatus('invalid');
      }
    }, 4000);
    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem =
      password.length < MIN_PASSWORD_LENGTH
        ? t('workspace.reset.tooShort', { min: MIN_PASSWORD_LENGTH })
        : password !== confirm
          ? t('workspace.reset.mismatch')
          : null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(
        updateError.message.toLowerCase().includes('different from the old')
          ? t('workspace.reset.mustDiffer')
          : updateError.message || t('workspace.reset.failed'),
      );
      return;
    }
    setStatus('done');
    window.setTimeout(() => setLocation('/dashboard'), 1500);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <BrandLockup />
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-2xl font-bold tracking-tight text-center">{t('workspace.reset.title')}</CardTitle>
            <CardDescription className="text-center">
              {status === 'invalid'
                ? t('workspace.reset.invalid')
                : status === 'done'
                  ? t('workspace.reset.done')
                  : t('workspace.reset.choose', { min: MIN_PASSWORD_LENGTH })}
            </CardDescription>
          </CardHeader>

          {status === 'checking' && (
            <CardContent className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </CardContent>
          )}

          {status === 'invalid' && (
            <CardFooter className="flex flex-col space-y-3 pt-2">
              <Button className="w-full" onClick={() => setLocation('/forgot-password')}>
                {t('workspace.reset.requestNew')}
              </Button>
              <a href="/login" className="text-xs text-primary font-medium hover:underline">
                {t('workspace.forgot.backToSignIn')}
              </a>
            </CardFooter>
          )}

          {status === 'done' && (
            <CardContent className="flex justify-center py-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </CardContent>
          )}

          {status === 'ready' && (
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="new-password">{t('workspace.reset.newPassword')}</Label>
                  <PasswordInput
                    id="new-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    disabled={saving}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">{t('workspace.reset.confirm')}</Label>
                  <PasswordInput
                    id="confirm-password"
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); setError(null); }}
                    required
                    disabled={saving}
                    autoComplete="new-password"
                  />
                </div>
              </CardContent>
              <CardFooter className="pt-4">
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('workspace.reset.save')}
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
