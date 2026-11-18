import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { BrandLockup } from '@/components/BrandLockup';
import { LegalDocument, LegalTabs, legalTitle, type LegalKind } from '@/components/LegalDocument';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { lastPage } from '@/lib/last-page';

/** Public Privacy Notice / Terms page: Terms | Privacy tabs, a contents list, and a Back button. */
export default function Legal({ kind }: { kind: LegalKind }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [, setLocation] = useLocation();

  // Back to the page of this app you came from (sign-up, sign-in, demo, or a page inside the app);
  // opened directly, go home.
  const back = () => setLocation(lastPage() ?? (session ? '/dashboard' : '/login'));

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
            <ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" />
            {t('legal.back')}
          </Button>
          <BrandLockup className="hidden sm:flex" />
        </div>
        <article className="rounded-xl border bg-card p-6 sm:p-8 shadow-sm">
          <LegalTabs
            kind={kind}
            onChange={(k) => {
              setLocation(`/${k}`, { replace: true });
              window.scrollTo({ top: 0 });
            }}
          />
          <h2 className="mt-5 text-2xl font-bold tracking-tight">{legalTitle(kind)}</h2>
          <LegalDocument kind={kind} />
        </article>
      </div>
    </div>
  );
}
