import { useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

/** Shown to a superadmin inside the demo agency: changes work but are thrown away on leaving. */
export function DemoBanner() {
  const { isPlatformAdmin, inDemo, leaveDemo } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isPlatformAdmin || !inDemo) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-300 bg-violet-50 px-4 py-2 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100">
      <span className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 shrink-0" />
        Demo agency: try anything. Every change is thrown away when you leave.
        {error && <span className="text-destructive">{error}</span>}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await leaveDemo();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
        Leave demo
      </Button>
    </div>
  );
}
