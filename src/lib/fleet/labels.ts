import type { BadgeVariant } from '@/components/ui/badge';

// Hebrew labels + badge tones for fleet requests and goals.
//
// Deliberately NO 'use client' directive: these maps are read by Server
// Components (the /admin/fleet pages) AND by client components. They used to
// live in fleet-client.tsx ('use client'), and a Server Component that imports
// a value from a client module receives a client *reference*, not the object
// (node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md)
// — every server-side lookup silently fell back to the raw English value.
//
// The keys mirror the DB CHECK constraints exactly (fleet_requests_kind_check,
// fleet_requests_status_check, fleet_goals_status_check); labels.test.ts pins
// that so a new status can't ship without a label.

export const REQUEST_KINDS = ['approval', 'question', 'fyi'] as const;
export const REQUEST_STATUSES = [
  'pending',
  'approved',
  'denied',
  'answered',
  'expired',
  'consumed',
  'completed',
] as const;
export const GOAL_STATUSES = ['active', 'paused', 'completed', 'failed'] as const;

export const KIND_LABEL: Record<string, string> = {
  approval: 'בקשת אישור',
  question: 'שאלה',
  fyi: 'לידיעה',
};

export const KIND_VARIANT: Record<string, BadgeVariant> = {
  approval: 'warning',
  question: 'info',
  fyi: 'neutral',
};

// 'completed' takes a different Hebrew form for a בקשה ("הושלם") vs a מטרה
// ("הושלמה"), so request and goal maps stay separate.
export const STATUS_LABEL: Record<string, string> = {
  pending: 'ממתינה למענה',
  approved: 'אושר',
  denied: 'נדחה',
  answered: 'נענה',
  expired: 'פג תוקף',
  consumed: 'נקלט אצל הסוכן',
  completed: 'הושלם',
};

export const STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'warning',
  approved: 'success',
  denied: 'destructive',
  answered: 'info',
  expired: 'neutral',
  consumed: 'success',
  completed: 'success',
};

export const GOAL_STATUS_LABEL: Record<string, string> = {
  active: 'פעילה',
  paused: 'מושהית',
  completed: 'הושלמה',
  failed: 'נכשלה',
};

export const GOAL_STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'destructive',
};

export const TIER_LABEL: Record<number, string> = {
  0: 'דרגה 0 — דיווח',
  1: 'דרגה 1 — קוד/בטא',
  2: 'דרגה 2 — רגיש',
};
