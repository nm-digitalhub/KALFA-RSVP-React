import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Up to two uppercase initials from a display name, falling back to an
// email/handle. "Netanel Mevorach" → "NM", "נטלי" → "נ", "admin@x.com" → "A".
export function getInitials(value: string | undefined | null): string {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean)
  const initials = parts.slice(0, 2).map((word) => word[0]).join("")
  return initials.toUpperCase() || "?"
}
