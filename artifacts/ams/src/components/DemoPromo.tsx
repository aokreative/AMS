import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { PlayCircle } from 'lucide-react';

/** "Try the demo" card under the sign-in and sign-up forms. */
export function DemoPromo() {
  const { t } = useTranslation();
  return (
    <Link
      href="/demo"
      className="mt-4 flex items-center gap-3 rounded-xl border border-dashed bg-card/60 p-4 text-start transition-colors hover:border-primary hover:bg-primary/5"
    >
      <PlayCircle className="h-8 w-8 shrink-0 text-primary" />
      <span>
        <span className="block text-sm font-semibold">{t('auth.tryDemo')}</span>
        <span className="block text-xs text-muted-foreground">{t('auth.tryDemoHint')}</span>
      </span>
    </Link>
  );
}

/** Terms · Privacy links under the auth cards. */
export function AuthLegalLinks() {
  const { t } = useTranslation();
  return (
    <p className="mt-4 text-center text-xs text-muted-foreground">
      <Link href="/privacy" className="hover:underline">{t('auth.privacyLink')}</Link>
      <span className="mx-2">·</span>
      <Link href="/terms" className="hover:underline">{t('auth.termsLink')}</Link>
    </p>
  );
}
