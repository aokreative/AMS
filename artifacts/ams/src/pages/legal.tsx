import { BrandLockup } from '@/components/BrandLockup';
import { PRIVACY, TERMS } from '@/legal/content';
import { LAST_UPDATED } from '@/legal/entity';

/** Public Privacy Notice / Terms page. */
export default function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const doc = kind === 'privacy' ? PRIVACY : TERMS;
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex justify-center mb-8">
          <BrandLockup />
        </div>
        <article className="rounded-xl border bg-card p-6 sm:p-8 shadow-sm">
          <h2 className="text-2xl font-bold tracking-tight">{doc.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Last updated {LAST_UPDATED}</p>
          <p className="mt-4 text-sm leading-relaxed">{doc.intro}</p>
          {doc.sections.map((s) => (
            <section key={s.heading} className="mt-6">
              <h3 className="text-base font-semibold">{s.heading}</h3>
              <div className="mt-2 text-sm leading-relaxed text-foreground/90">{s.body}</div>
            </section>
          ))}
          <div className="mt-8 flex flex-wrap gap-4 text-sm">
            <a href={kind === 'privacy' ? '/terms' : '/privacy'} className="text-primary hover:underline">
              {kind === 'privacy' ? 'Terms of Service' : 'Privacy Notice'}
            </a>
            <a href="/login" className="text-primary hover:underline">Back to sign in</a>
          </div>
        </article>
      </div>
    </div>
  );
}
