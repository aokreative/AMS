import { Checkbox } from '@/components/ui/checkbox';

/** Required "I agree" checkbox for sign-up and invite acceptance. Links open in a new tab. */
export function TermsConsent({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="terms"
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        className="mt-0.5"
        aria-required
      />
      <label htmlFor="terms" className="text-sm leading-snug text-muted-foreground">
        I agree to the{' '}
        <a href="/terms" target="_blank" rel="noreferrer" className="text-primary hover:underline">Terms</a>
        {' '}and the{' '}
        <a href="/privacy" target="_blank" rel="noreferrer" className="text-primary hover:underline">Privacy Notice</a>
      </label>
    </div>
  );
}

export const TERMS_REQUIRED_MESSAGE = 'Accept the Terms and Privacy Notice to continue';
