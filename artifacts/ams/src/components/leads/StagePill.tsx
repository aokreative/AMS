import { useTranslation } from 'react-i18next';
import type { LeadStage } from '@/lib/leads';
import { cn } from '@/lib/utils';

const STYLE: Record<LeadStage, string> = {
  new: 'bg-muted text-foreground',
  contacted: 'bg-primary/10 text-primary',
  quoted: 'bg-due/15 text-due',
  won: 'bg-money/15 text-money',
  paid: 'bg-money text-white dark:text-background',
  lost: 'bg-overdue/15 text-overdue',
};

export function StagePill({ stage, className }: { stage: LeadStage; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', STYLE[stage], className)}>
      {t(`workspace.stage.${stage}`)}
    </span>
  );
}
