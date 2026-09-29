/**
 * Pure date utility for Ontario school-local calendar calculations.
 * Always resolves against America/Toronto timezone without database dependencies.
 */

import { ValidationError } from '../services/markbookService';
export { ValidationError };

export function getSchoolLocalDate(date: Date = new Date(), timeZone: string = 'America/Toronto'): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error(`Failed to extract school date parts for timezone ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

export function getCurrentTorontoTime(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  let hour = parts.find(p => p.type === 'hour')?.value || '09';
  if (hour === '24') hour = '00';
  const min = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
}

export function shiftSchoolDate(dateStr: string, deltaDays: number): string {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const d = new Date(Date.UTC(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10), 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return getSchoolLocalDate(d);
}

export function formatTorontoDateTime(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  }).format(date);
}

export function formatSchoolDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

/**
 * Builds an exact ISO 8601 UTC timestamp corresponding to the requested date (YYYY-MM-DD)
 * and time (HH:mm or HH:mm:ss) in America/Toronto.
 *
 * Strict behavior:
 * - Validates calendar validity (rejects invalid months, days e.g. Feb 30).
 * - Rejects nonexistent times during daylight-saving spring-forward gap (e.g. 2:00-2:59 on spring-forward).
 * - For repeated times during the fall-back overlap, chooses the earlier occurrence (EDT / UTC-4).
 * - Confirms via round-trip conversion that the resulting UTC instant formats back to the exact
 *   requested Toronto date and time. Throws ValidationError if conversion fails.
 */
export function buildTorontoTimestamp(dateStr: string, timeStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ValidationError(`Invalid date format "${dateStr}". Expected YYYY-MM-DD.`);
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(timeStr)) {
    throw new ValidationError(`Invalid time format "${timeStr}". Expected HH:mm or HH:mm:ss.`);
  }

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12) {
    throw new ValidationError(`Invalid month "${monthStr}". Must be 01-12.`);
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    throw new ValidationError(`Invalid calendar date "${dateStr}". Month ${monthStr} only has ${daysInMonth} days.`);
  }

  const timeParts = timeStr.split(':');
  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = timeParts[2] ? parseInt(timeParts[2], 10) : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    throw new ValidationError(`Invalid time values in "${timeStr}".`);
  }

  // Initial estimate assuming UTC-4 (EDT, earlier occurrence for overlap)
  const candidateUtcMs = Date.UTC(year, month - 1, day, hours, minutes, seconds, 0) + (4 * 60 * 60 * 1000);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  function getParts(ms: number) {
    const parts = formatter.formatToParts(new Date(ms));
    const pYear = parts.find(p => p.type === 'year')?.value;
    const pMonth = parts.find(p => p.type === 'month')?.value;
    const pDay = parts.find(p => p.type === 'day')?.value;
    let pHour = parts.find(p => p.type === 'hour')?.value;
    if (pHour === '24') pHour = '00';
    const pMin = parts.find(p => p.type === 'minute')?.value;
    const pSec = parts.find(p => p.type === 'second')?.value;
    return {
      date: `${pYear}-${pMonth}-${pDay}`,
      time: `${pHour}:${pMin}` + (timeParts[2] ? `:${pSec}` : '')
    };
  }

  let resolvedMs = candidateUtcMs;
  for (let step = 0; step < 4; step++) {
    const p = getParts(resolvedMs);
    const expectedTime = timeParts[2]
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    if (p.date === dateStr && p.time === expectedTime) {
      break;
    }
    if (step === 0) {
      // Try EST offset (+5 hours)
      resolvedMs = Date.UTC(year, month - 1, day, hours, minutes, seconds, 0) + (5 * 60 * 60 * 1000);
    } else {
      break;
    }
  }

  // Round-trip verification:
  const finalCheck = getParts(resolvedMs);
  const requestedFormattedTime = timeParts[2]
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  if (finalCheck.date !== dateStr || finalCheck.time !== requestedFormattedTime) {
    throw new ValidationError(
      `Date/time "${dateStr} ${timeStr}" is invalid or nonexistent in America/Toronto (e.g. within daylight saving spring-forward gap).`
    );
  }

  return new Date(resolvedMs).toISOString();
}
