import { Ban, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { BrandMark } from '@/components/BrandLockup';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DATA_CONTACT_EMAIL } from '@/legal/entity';

/** Shown to every member of an agency a superadmin has suspended. */
export function SuspendedScreen() {
  const { agency, signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <BrandMark className="h-10 w-10" />
          <div className="mt-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <Ban className="h-5 w-5 text-destructive" />
          </div>
          <CardTitle className="mt-2">This account is suspended</CardTitle>
          <CardDescription>
            {agency?.name} can't be used right now. Your data is kept safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center text-sm">
          {agency?.suspended_reason && (
            <p className="rounded-lg bg-muted p-3 text-start">
              <span className="font-medium">Reason: </span>
              {agency.suspended_reason}
            </p>
          )}
          <p className="text-muted-foreground">
            Questions? Write to <a className="text-primary underline" href={`mailto:${DATA_CONTACT_EMAIL}`}>{DATA_CONTACT_EMAIL}</a>.
          </p>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut className="me-2 h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
