import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { PlanPicker } from './PlanPicker';

export function PayDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('onboarding.planTitle')}</DialogTitle>
          <DialogDescription>{t('onboarding.planHint')}</DialogDescription>
        </DialogHeader>
        <PlanPicker
          active={open}
          footer={<Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>}
        />
      </DialogContent>
    </Dialog>
  );
}
