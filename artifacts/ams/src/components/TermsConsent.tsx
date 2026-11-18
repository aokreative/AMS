import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from 'react-i18next';
import { LegalDialog, type LegalKind } from '@/components/LegalDocument';

/**
 * Required "I agree" checkbox for sign-up and invite acceptance. The Terms and Privacy links open
 * the documents in a pop-up (not a new tab), and sit outside the checkbox label so reading them
 * never ticks or unticks the box.
 */
export function TermsConsent({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<LegalKind | null>(null);
  const link = (kind: LegalKind, text: string) => (
    <button type="button" onClick={() => setOpen(kind)} className="text-primary underline-offset-2 hover:underline">
      {text}
    </button>
  );
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="terms"
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        className="mt-0.5"
        aria-required
        aria-labelledby="terms-label"
      />
      <p className="text-sm leading-snug text-muted-foreground">
        <label id="terms-label" htmlFor="terms" className="cursor-pointer">{t('auth.agree')}</label>{' '}
        {link('terms', t('auth.terms'))} {t('auth.and')} {link('privacy', t('auth.privacy'))}
      </p>
      <LegalDialog kind={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export const TERMS_REQUIRED_MESSAGE = 'Accept the Terms and Privacy Notice to continue';
