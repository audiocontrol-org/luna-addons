// The Add On's semantic vocabulary: the roles a layout may bind a button to. api.ts re-exports it.
export type Role = 'page.next' | 'page.previous' | 'transport.play' | 'transport.record';

export const ROLES: readonly Role[] = ['page.next', 'page.previous', 'transport.play', 'transport.record'];
