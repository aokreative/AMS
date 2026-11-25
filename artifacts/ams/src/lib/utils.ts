import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatMoney } from './money';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Amount in the signed-in agency's currency (see lib/money). */
export function formatCurrency(amount: number | null | undefined): string {
  return formatMoney(amount);
}

/** Locale for dates and numbers: the interface language (English shows day-month-year). */
export function displayLocale(): string {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : '';
  if (!lang || lang === 'en') return 'en-GB';
  return lang === 'sw' ? 'sw-KE' : lang;
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(displayLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

export function getStatusColor(status: string): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" {
  switch (status.toLowerCase()) {
    case 'active':
    case 'received':
      return 'success';
    case 'pending':
      return 'warning';
    case 'overdue':
    case 'expired':
    case 'cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}
