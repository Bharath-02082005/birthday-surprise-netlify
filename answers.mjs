import { timingSafeEqual, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'birthday-favour-replies';
const MAX_BODY_BYTES = 4096;
const MAX_ANSWER_LENGTH = 500;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function hasValidAdminCode(request) {
  const expected = Buffer.from(process.env.ADMIN_CODE || '', 'utf8');
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const supplied = Buffer.from(match ? match[1].trim() : '', 'utf8');

  return expected.length > 0 &&
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected);
}

export default async function handler(request) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (!process.env.ADMIN_CODE) {
    return json({ error: 'The site admin code has not been configured yet.' }, 503);
  }

  try {
    const store = getStore(STORE_NAME);

    if (request.method === 'GET') {
      if (!hasValidAdminCode(request)) {
        return json({ error: 'Admin code required.' }, 401);
      }

      const { blobs } = await store.list({ prefix: 'answers/' });
      const records = await Promise.all(blobs.map(async ({ key }) => {
        const record = await store.get(key, { type: 'json' });
        return record && typeof record.answer === 'string' ? record : null;
      }));

      const validRecords = records.filter(record =>
        record && typeof record.answer === 'string' && typeof record.submittedAt === 'string'
      );
      validRecords.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));
      return json(validRecords);
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return json({ error: 'Answer is too large.' }, 413);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }

    const answer = typeof payload?.answer === 'string' ? payload.answer.trim() : '';
    if (!answer || answer.length > MAX_ANSWER_LENGTH) {
      return json({ error: 'Please enter an answer of 1 to 500 characters.' }, 400);
    }

    const record = { answer, submittedAt: new Date().toISOString() };
    const key = `answers/${Date.now()}-${randomUUID()}`;
    await store.set(key, JSON.stringify(record));
    return json({ ok: true, submittedAt: record.submittedAt }, 201);
  } catch (error) {
    console.error('Birthday reply function failed:', error);
    return json({ error: 'Could not process the reply.' }, 500);
  }
}

export const config = {
  path: '/api/answers'
};