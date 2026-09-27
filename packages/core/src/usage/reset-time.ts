// Convierte "12:10pm" o "Oct 3, 9am" en una zona horaria IANA a milisegundos UTC.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

interface ZonedParts {
  year: number;
  month: number;
  day: number;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function partsOf(utc: number, timeZone: string): Record<string, number> {
  return Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(utc))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

/** Minutos que la zona horaria está adelantada respecto de UTC en ese instante. */
function offsetMinutes(utc: number, timeZone: string): number {
  const p = partsOf(utc, timeZone);
  const asUtc = Date.UTC(
    p.year ?? 0,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  return Math.round((asUtc - utc) / 60_000);
}

/** Hora local de pared en `timeZone` a UTC; dos pasadas cubren los cambios de horario. */
export function zonedTimeToUtc(
  date: ZonedParts,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = wall - offsetMinutes(wall, timeZone) * 60_000;
  return wall - offsetMinutes(first, timeZone) * 60_000;
}

function zonedDate(utc: number, timeZone: string): ZonedParts {
  const p = partsOf(utc, timeZone);
  return { year: p.year ?? 1970, month: p.month ?? 1, day: p.day ?? 1 };
}

function addDays(date: ZonedParts, days: number): ZonedParts {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

const RESET = /^(?:([a-z]{3})[a-z]*\.? (\d{1,2}),?(?: at)? )?(\d{1,2})(?::(\d{2}))?\s?(am|pm)$/i;

/**
 * Hora de reinicio de un aviso de límite. Sin fecha, es la próxima vez que el reloj de esa
 * zona marque esa hora a partir del aviso. Devuelve `null` si el texto o la zona no se entienden.
 */
export function parseResetTime(text: string, timeZone: string, reference: number): number | null {
  const match = RESET.exec(text.trim());
  if (match === null) return null;
  const [, monthName, dayText, hourText = "0", minuteText = "0", meridiem = "am"] = match;
  const clockHour = Number(hourText);
  if (clockHour < 1 || clockHour > 12) return null;
  let hour = clockHour % 12;
  if (meridiem.toLowerCase() === "pm") hour += 12;
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) return null;
  try {
    const today = zonedDate(reference, timeZone);
    if (monthName !== undefined && dayText !== undefined) {
      const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
      if (month === 0) return null;
      let date = { year: today.year, month, day: Number(dayText) };
      // Un aviso de diciembre puede reiniciar en enero del año siguiente.
      if (zonedTimeToUtc(date, hour, minute, timeZone) < reference - 24 * 60 * 60_000) {
        date = { ...date, year: date.year + 1 };
      }
      return zonedTimeToUtc(date, hour, minute, timeZone);
    }
    const candidate = zonedTimeToUtc(today, hour, minute, timeZone);
    // El aviso muestra la hora redondeada al minuto: un reinicio "a las 12:10" emitido a las
    // 12:10:30 sigue siendo de hoy.
    return candidate >= reference - 60_000
      ? candidate
      : zonedTimeToUtc(addDays(today, 1), hour, minute, timeZone);
  } catch {
    return null;
  }
}

/** Fecha `YYYY-MM-DD` de un instante en la zona horaria dada. */
export function localDate(utc: number, timeZone: string): string {
  const { year, month, day } = zonedDate(utc, timeZone);
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
