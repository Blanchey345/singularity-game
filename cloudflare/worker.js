const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function response(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store"
    }
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? previous
        : 1 + Math.min(previous, row[j], row[j - 1]);
      previous = old;
    }
  }
  return row[b.length];
}

function matchAnswer(question, raw) {
  const target = normalize(raw);
  if (target.length < 2) return null;

  const exact = [];
  for (const answer of question.answers) {
    if ((answer.aliases || []).some(alias => normalize(alias) === target)) exact.push(answer);
  }
  if (exact.length === 1) return { answer: exact[0], exact: true };
  if (exact.length > 1) return null;

  const suggestions = [];
  for (const answer of question.answers) {
    let best = Infinity;
    for (const alias of answer.aliases || []) {
      const key = normalize(alias);
      if (Math.max(key.length, target.length) < 4) continue;
      const distance = editDistance(target, key);
      const max = Math.max(key.length, target.length);
      const allowed = max >= 11 ? 2 : max >= 7 ? 1 : 0;
      if (distance > 0 && distance <= allowed) best = Math.min(best, distance);
    }
    if (best < Infinity) suggestions.push({ answer, distance: best });
  }
  suggestions.sort((a, b) => a.distance - b.distance);
  if (!suggestions.length) return null;
  if (suggestions.length > 1 && suggestions[0].distance === suggestions[1].distance) return null;
  return { answer: suggestions[0].answer, exact: false };
}

async function readSession(env, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) return null;
  const raw = await env.SESSIONS.get("session:" + id);
  return raw ? JSON.parse(raw) : null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "*";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const corsOrigin = allowed === "*" || origin === allowed ? origin : allowed;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": corsOrigin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400"
        }
      });
    }
    if (allowed !== "*" && origin !== allowed) return response({ error: "Origin not allowed." }, 403, corsOrigin);

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api") return response({ error: "Not found." }, 404, corsOrigin);

    try {
      if (request.method === "GET" && parts[1] === "daily" && parts[2]) {
        const date = parts[2];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return response({ error: "Invalid date." }, 400, corsOrigin);
        const raw = await env.DAILY_DATA.get("daily:" + date);
        if (!raw) return response({ error: "Daily challenge is not prepared yet." }, 404, corsOrigin);
        const challenge = JSON.parse(raw);
        return response({
          date: challenge.date,
          questions: challenge.questions.map((q, index) => ({ index, id: q.id, prompt: q.prompt }))
        }, 200, corsOrigin);
      }

      if (request.method === "POST" && parts[1] === "start") {
        const body = await request.json();
        const date = String(body.date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return response({ error: "Invalid date." }, 400, corsOrigin);
        const raw = await env.DAILY_DATA.get("daily:" + date);
        if (!raw) return response({ error: "Daily challenge is not prepared yet." }, 404, corsOrigin);
        const challenge = JSON.parse(raw);
        const sessionId = crypto.randomUUID();
        const session = {
          date,
          answers: Array(challenge.questions.length).fill(null),
          createdAt: Date.now(),
          completed: false
        };
        await env.SESSIONS.put("session:" + sessionId, JSON.stringify(session), { expirationTtl: 172800 });
        return response({
          sessionId,
          date,
          questions: challenge.questions.map((q, index) => ({ index, id: q.id, prompt: q.prompt }))
        }, 200, corsOrigin);
      }

      if (request.method === "POST" && parts[1] === "answer") {
        const body = await request.json();
        const sessionId = String(body.sessionId || "");
        const index = Number(body.index);
        const rawAnswer = String(body.answer || "");
        const session = await readSession(env, sessionId);
        if (!session) return response({ error: "Session expired or not found." }, 404, corsOrigin);
        if (session.completed) return response({ error: "This session is already complete." }, 409, corsOrigin);

        const challengeRaw = await env.DAILY_DATA.get("daily:" + session.date);
        if (!challengeRaw) return response({ error: "Challenge data is unavailable." }, 404, corsOrigin);
        const challenge = JSON.parse(challengeRaw);
        if (!Number.isInteger(index) || index < 0 || index >= challenge.questions.length) {
          return response({ error: "Invalid round." }, 400, corsOrigin);
        }
        if (session.answers[index]) return response({ error: "This round has already been submitted." }, 409, corsOrigin);

        const question = challenge.questions[index];
        const match = matchAnswer(question, rawAnswer);
        if (!match) return response({ accepted: false }, 200, corsOrigin);

        if (!match.exact) {
          return response({
            accepted: false,
            suggestion: { name: match.answer.name }
          }, 200, corsOrigin);
        }

        session.answers[index] = {
          answerId: match.answer.id,
          name: match.answer.name,
          points: match.answer.points,
          tier: match.answer.tier
        };
        session.completed = session.answers.every(Boolean);
        await env.SESSIONS.put("session:" + sessionId, JSON.stringify(session), { expirationTtl: 172800 });
        return response({
          accepted: true,
          answer: session.answers[index],
          completed: session.completed
        }, 200, corsOrigin);
      }

      if (request.method === "POST" && parts[1] === "skip") {
        const body = await request.json();
        const sessionId = String(body.sessionId || "");
        const index = Number(body.index);
        const session = await readSession(env, sessionId);
        if (!session) return response({ error: "Session expired or not found." }, 404, corsOrigin);
        const challengeRaw = await env.DAILY_DATA.get("daily:" + session.date);
        if (!challengeRaw) return response({ error: "Challenge data is unavailable." }, 404, corsOrigin);
        const challenge = JSON.parse(challengeRaw);
        if (!Number.isInteger(index) || index < 0 || index >= challenge.questions.length) {
          return response({ error: "Invalid round." }, 400, corsOrigin);
        }
        if (!session.answers[index]) session.answers[index] = { skipped: true, points: 0 };
        session.completed = session.answers.every(Boolean);
        await env.SESSIONS.put("session:" + sessionId, JSON.stringify(session), { expirationTtl: 172800 });
        return response({ completed: session.completed }, 200, corsOrigin);
      }

      if (request.method === "GET" && parts[1] === "recap") {
        const sessionId = url.searchParams.get("session") || "";
        const session = await readSession(env, sessionId);
        if (!session) return response({ error: "Session expired or not found." }, 404, corsOrigin);
        if (!session.completed) return response({ error: "Finish all seven rounds to unlock the answer explorer." }, 403, corsOrigin);
        const challengeRaw = await env.DAILY_DATA.get("daily:" + session.date);
        if (!challengeRaw) return response({ error: "Challenge data is unavailable." }, 404, corsOrigin);
        const challenge = JSON.parse(challengeRaw);
        return response({
          date: session.date,
          answers: session.answers,
          questions: challenge.questions.map((q, index) => ({
            id: q.id,
            prompt: q.prompt,
            submitted: session.answers[index],
            answers: q.answers
          }))
        }, 200, corsOrigin);
      }

      return response({ error: "Not found." }, 404, corsOrigin);
    } catch (error) {
      return response({ error: "The daily service encountered an error." }, 500, corsOrigin);
    }
  }
};
