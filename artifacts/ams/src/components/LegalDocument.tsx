import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PRIVACY, TERMS } from '@/legal/content';
import { LAST_UPDATED } from '@/legal/entity';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type LegalKind = 'privacy' | 'terms';

const DOCS = { privacy: PRIVACY, terms: TERMS } as const;

export function legalTitle(kind: LegalKind): string {
  return DOCS[kind].title;
}

function anchor(kind: LegalKind, i: number) {
  return `${kind}-${i + 1}`;
}

/** Terms | Privacy switch shown above a document. */
export function LegalTabs({ kind, onChange }: { kind: LegalKind; onChange: (k: LegalKind) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border bg-muted p-1 text-sm">
      {(['terms', 'privacy'] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={kind === k}
          onClick={() => onChange(k)}
          className={cn('rounded-md px-3 py-1.5 font-medium transition-colors', kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          {DOCS[k].title}
        </button>
      ))}
    </div>
  );
}

/** The body of the Terms or Privacy Notice, with a clickable list of sections. */
export function LegalDocument({ kind, scrollRoot }: { kind: LegalKind; scrollRoot?: HTMLElement | null }) {
  const { t } = useTranslation();
  const doc = DOCS[kind];
  const jump = (id: string) => {
    const el = (scrollRoot ?? document).querySelector(`#${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div>
      <p className="text-xs text-muted-foreground">Last updated {LAST_UPDATED}</p>
      <p className="mt-4 text-sm leading-relaxed">{doc.intro}</p>
      <nav aria-label={t('legal.contents')} className="mt-5 rounded-lg border bg-muted/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('legal.contents')}</p>
        <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {doc.sections.map((s, i) => (
            <li key={s.heading}>
              <a
                href={`#${anchor(kind, i)}`}
                onClick={(e) => {
                  e.preventDefault();
                  jump(anchor(kind, i));
                }}
                className="text-primary hover:underline"
              >
                {i + 1}. {s.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {doc.sections.map((s, i) => (
        <section key={s.heading} id={anchor(kind, i)} className="mt-6 scroll-mt-32">
          <h3 className="text-base font-semibold">{i + 1}. {s.heading}</h3>
          <div className="mt-2 text-sm leading-relaxed text-foreground/90">{s.body}</div>
        </section>
      ))}
    </div>
  );
}

/** Terms or Privacy Notice in a pop-up, so the page underneath (e.g. a half-filled form) stays as it is. */
export function LegalDialog({ kind, onClose }: { kind: LegalKind | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<LegalKind>('terms');
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (kind) setCurrent(kind);
  }, [kind]);
  const shown = current;
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        ref={setRoot}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="sticky -top-6 z-10 -mx-6 -mt-6 gap-3 border-b bg-background px-6 pb-3 pt-6 text-start">
          <div className="flex items-center justify-between gap-3 pe-6">
            <DialogTitle>{legalTitle(shown)}</DialogTitle>
            <DialogClose asChild>
              <Button variant="outline" size="sm">{t('common.close')}</Button>
            </DialogClose>
          </div>
          <LegalTabs
            kind={shown}
            onChange={(k) => {
              setCurrent(k);
              root?.scrollTo({ top: 0 });
            }}
          />
        </DialogHeader>
        <LegalDocument kind={shown} scrollRoot={root} />
      </DialogContent>
    </Dialog>
  );
}
