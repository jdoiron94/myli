import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names, letting later Tailwind classes override earlier ones (`px-2` then `px-4`
 * gives `px-4`). The shadcn-vue components take a `class` prop through it.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
