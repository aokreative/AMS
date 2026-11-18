/** Remembers the last in-app page that is not a legal page, so "Back" on Terms/Privacy returns there. */
const LEGAL = ['/terms', '/privacy'];
let last: string | null = null;

export function notePage(path: string): void {
  if (!LEGAL.includes(path)) last = path;
}

export function lastPage(): string | null {
  return last;
}
