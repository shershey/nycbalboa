import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSessions } from './fetch-ysbd.mjs';

function sessionHtml({ containerClass = 'bw-session', cart = '', availabilityId = '27215' }) {
  return `
    <div class="bw-widget__day">
      <div class="date-2026-07-27"></div>
      <div class="${containerClass}" data-bw-widget-mbo-class-id="${availabilityId}">
        <time class="hc_starttime" datetime="2026-07-27T18:00"></time>
        <time class="hc_endtime" datetime="2026-07-27T19:00"></time>
        <div class="bw-session__name">Level 1 - Lindy Hop</div>
        <span class="bw-widget__cart_button">${cart}</span>
        <div class="bw-session__canceled">Cancelled</div>
      </div>
    </div>`;
}

test('an active session with a signup action is not cancelled', () => {
  const html = sessionHtml({
    cart: '<a class="bw-widget__cta signup_now" href="https://example.com/register">Register</a>',
  });

  const [session] = parseSessions(html, 'class', {
    27215: { isCanceled: false },
  });

  assert.equal(session.cancelled, false);
  assert.equal(session.registerUrl, 'https://example.com/register');
});

test('Mindbody availability marks a session as cancelled', () => {
  const [session] = parseSessions(sessionHtml({}), 'class', {
    27215: { isCanceled: true },
  });

  assert.equal(session.cancelled, true);
  assert.equal(session.registerUrl, null);
});

test('a cancelled container modifier remains supported when availability is absent', () => {
  const html = sessionHtml({
    containerClass: 'bw-session bw-session--canceled',
    cart: '<a class="bw-widget__cta signup_now" href="https://example.com/register">Register</a>',
  });

  const [session] = parseSessions(html, 'class');

  assert.equal(session.cancelled, true);
});
