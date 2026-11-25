import React, { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, ChevronRight, X, Rocket } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
}

interface Props {
  agencyId: string;
  hasInsurers: boolean;
  hasClients: boolean;
  hasPolicies: boolean;
}

export function OnboardingChecklist({ agencyId, hasInsurers, hasClients, hasPolicies }: Props) {
  const { t } = useTranslation();
  const storageKey = `ams-onboarding-dismissed-${agencyId}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey) === 'true'; } catch { return false; }
  });

  const steps: ChecklistStep[] = [
    {
      id: 'insurers',
      label: t('workspace.checklist.insurersLabel'),
      description: t('workspace.checklist.insurersDesc'),
      href: '/insurers',
      done: hasInsurers,
    },
    {
      id: 'clients',
      label: t('workspace.checklist.clientsLabel'),
      description: t('workspace.checklist.clientsDesc'),
      href: '/clients',
      done: hasClients,
    },
    {
      id: 'policies',
      label: t('workspace.checklist.policiesLabel'),
      description: t('workspace.checklist.policiesDesc'),
      href: '/policies',
      done: hasPolicies,
    },
  ];

  const completedCount = steps.filter(s => s.done).length;
  const allDone = completedCount === steps.length;

  // Auto-dismiss 3 seconds after all steps are complete
  useEffect(() => {
    if (allDone && !dismissed) {
      const timer = setTimeout(() => dismiss(), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [allDone, dismissed]);

  const dismiss = () => {
    try { localStorage.setItem(storageKey, 'true'); } catch {}
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <Card className="border-primary/20 bg-primary/5 dark:bg-primary/10">
      <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-primary" />
          <div>
            <p className="font-semibold text-sm">
              {allDone ? t('workspace.checklist.doneTitle') : t('workspace.checklist.startTitle')}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {allDone
                ? t('workspace.checklist.doneBody')
                : t('workspace.checklist.progress', { done: completedCount, total: steps.length })}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 -mt-1 -me-1" onClick={dismiss} aria-label={t('workspace.checklist.dismiss')}>
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        <Progress value={(completedCount / steps.length) * 100} className="h-1.5" />

        <div className="space-y-2">
          {steps.map(step => (
            <Link key={step.id} href={step.done ? '#' : step.href}>
              <div
                className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                  step.done
                    ? 'opacity-60 cursor-default'
                    : 'hover:bg-primary/10 cursor-pointer group'
                }`}
              >
                {step.done
                  ? <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                  : <Circle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${step.done ? 'line-through text-muted-foreground' : ''}`}>
                    {step.label}
                  </p>
                  {!step.done && (
                    <p className="text-xs text-muted-foreground truncate">{step.description}</p>
                  )}
                </div>
                {!step.done && (
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground flex-shrink-0 rtl:rotate-180" />
                )}
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
