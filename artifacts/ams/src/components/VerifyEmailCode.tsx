import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { cleanCode, isCompleteCode } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Loader2, MailCheck } from 'lucide-react';

const RESEND_SECONDS = 60;

/**
 * Email-code step for sign-up. On success the visitor is signed in and
 * `onVerified` runs. Drop inside a <Card>.
 */
export function VerifyEmailCode({
  email,
  onVerified,
  onChangeEmail,
  sendOnMount = false,
}: {
  email: string;
  onVerified: () => Promise<void> | void;
  onChangeEmail?: () => void;
  /** Send a fresh code when the step opens (e.g. arriving from sign-in). */
  sendOnMount?: boolean;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(sendOnMount ? 0 : RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  const resend = async () => {
    setError(null);
    setNotice(null);
    const { error: e } = await supabase.auth.resend({ type: 'signup', email });
    if (e) {
      setError(e.message);
      return;
    }
    setNotice(t('verify.resent'));
    setWait(RESEND_SECONDS);
  };

  useEffect(() => {
    if (sendOnMount) void resend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteCode(code) || busy) return;
    setBusy(true);
    setError(null);
    const { error: e2 } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' });
    if (e2) {
      setBusy(false);
      setError(t('verify.invalid'));
      return;
    }
    try {
      await onVerified();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <CardHeader className="space-y-1 pb-4 text-center">
        <MailCheck className="mx-auto h-8 w-8 text-primary" />
        <CardTitle className="text-2xl font-bold tracking-tight">{t('verify.title')}</CardTitle>
        <CardDescription>{t('verify.subtitle', { email })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
        <div className="space-y-2">
          <Label htmlFor="code">{t('verify.code')}</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            dir="ltr"
            className="text-center text-2xl tracking-[0.5em] font-semibold"
            value={code}
            onChange={(e) => { setCode(cleanCode(e.target.value)); setError(null); }}
            disabled={busy}
            placeholder="••••••"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('verify.spam')}</p>
      </CardContent>
      <CardFooter className="flex flex-col gap-3 pt-2">
        <Button type="submit" className="w-full" disabled={!isCompleteCode(code) || busy}>
          {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {busy ? t('verify.verifying') : t('verify.verify')}
        </Button>
        <div className="flex w-full items-center justify-between text-xs">
          <button type="button" className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline" onClick={() => void resend()} disabled={wait > 0}>
            {wait > 0 ? t('verify.resendIn', { seconds: wait }) : t('verify.resend')}
          </button>
          {onChangeEmail && (
            <button type="button" className="text-muted-foreground hover:underline" onClick={onChangeEmail}>
              {t('verify.wrongEmail')}
            </button>
          )}
        </div>
      </CardFooter>
    </form>
  );
}
