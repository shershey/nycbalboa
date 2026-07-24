import https from 'node:https';

const CALENDAR_ID =
  'cca341fd504d87e8bdc5d22fa803d7237b5d8ad34696729ca076f27f7c36881d@group.calendar.google.com';
const CALENDAR_TIME_ZONE = 'America/New_York';
const CALENDAR_FEED_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`;

function unfoldLines(source) {
  return source.replace(/\r?\n[ \t]/g, '');
}

function readProperty(block, name) {
  const match = block.match(new RegExp(`^${name}(?:;([^:]*))?:(.*)$`, 'm'));
  if (!match) return null;

  const parameters = Object.fromEntries(
    (match[1] || '')
      .split(';')
      .filter(Boolean)
      .map((parameter) => {
        const [key, ...value] = parameter.split('=');
        return [key, value.join('=')];
      })
  );

  return { parameters, value: match[2] };
}

function decodeText(value = '') {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function timeZoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return (
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    ) - date.getTime()
  );
}

function localDateToUtc(parts, timeZone) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const firstPass = new Date(utcGuess);
  const corrected = new Date(utcGuess - timeZoneOffset(firstPass, timeZone));

  return new Date(utcGuess - timeZoneOffset(corrected, timeZone));
}

function parseDate(property) {
  if (!property) return null;

  const value = property.value;
  const allDay = property.parameters.VALUE === 'DATE' || /^\d{8}$/.test(value);
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/
  );
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0),
  };

  if (match[7]) {
    return {
      allDay,
      date: new Date(
        Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          parts.hour,
          parts.minute,
          parts.second
        )
      ),
    };
  }

  return {
    allDay,
    date: localDateToUtc(
      parts,
      property.parameters.TZID || CALENDAR_TIME_ZONE
    ),
  };
}

function parseEvents(source) {
  const calendar = unfoldLines(source);
  const blocks = calendar.match(/BEGIN:VEVENT\r?\n[\s\S]*?\r?\nEND:VEVENT/g) || [];

  return blocks
    .map((block) => {
      const start = parseDate(readProperty(block, 'DTSTART'));
      const end = parseDate(readProperty(block, 'DTEND')) || start;
      const status = readProperty(block, 'STATUS')?.value;

      if (!start || !end || status === 'CANCELLED') return null;

      return {
        title: decodeText(readProperty(block, 'SUMMARY')?.value) || 'Untitled event',
        location: decodeText(readProperty(block, 'LOCATION')?.value),
        start: start.date,
        end: end.date,
        allDay: start.allDay,
      };
    })
    .filter(Boolean);
}

function requestCalendarFeed(url = CALENDAR_FEED_URL, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { Accept: 'text/calendar' } },
      (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location &&
          redirects < 3
        ) {
          response.resume();
          resolve(requestCalendarFeed(response.headers.location, redirects + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Calendar returned ${response.statusCode}`));
          return;
        }

        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve(body));
      }
    );

    request.setTimeout(8000, () => {
      request.destroy(new Error('Calendar request timed out'));
    });
    request.on('error', reject);
  });
}

export async function getUpcomingEvents(limit = 3) {
  try {
    const now = new Date();
    const events = parseEvents(await requestCalendarFeed())
      .filter((event) => event.end > now)
      .sort((a, b) => a.start - b.start)
      .slice(0, limit);

    return { events, error: false };
  } catch (error) {
    console.warn(`Unable to load upcoming Google Calendar events: ${error.message}`);
    return { events: [], error: true };
  }
}

export { CALENDAR_TIME_ZONE };
