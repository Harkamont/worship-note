export type ReviewActivity = 'conversion' | 'repair' | 'text';

/** Each tool releases only its own operation, including during child cleanup. */
export function createReviewBusyState() {
  const active = new Set<ReviewActivity>();
  return {
    update(source: ReviewActivity, busy: boolean): boolean {
      if (busy) active.add(source);
      else active.delete(source);
      return active.size > 0;
    },
    isBusy(): boolean { return active.size > 0; },
    clear(): void { active.clear(); },
  };
}
