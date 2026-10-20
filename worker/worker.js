/**
 * Cloudflare Worker: generates the activities for the "Would like, ask & tell" page with Gemini.
 *
 * Variables (Cloudflare dashboard → your Worker → Settings → Variables and Secrets):
 *   GEMINI_API_KEY   (type: Secret)  your Gemini API key. NEVER put it in index.html.
 *   ALLOWED_ORIGINS  (type: Text)    comma-separated page addresses allowed to call this Worker,
 *                                    e.g. https://youruser.github.io   ("*" = any site; only for testing)
 *   GEMINI_MODEL     (type: Text)    optional, default "gemini-2.5-flash"
 */

const SYSTEM = `You create English (ESL) practice content for students.
The grammar is always verb patterns with a to-infinitive:
- would like + (not) to + verb        e.g. "I would like to book a room." / "I would like not to lose any data."
- ask + person + (not) to + verb      e.g. "She asked me to help her." (requests, usually with "please" or "can you")
- tell + person + (not) to + verb     e.g. "The teacher told us not to run." (orders and instructions)
Negative infinitive = NOT + TO + verb (never "to not", "no to" or "don't to").
All sentences must be natural, grammatically perfect English at the requested CEFR level,
and must be about the requested topic, using the requested vocabulary whenever possible.
Write everything in English. Use straight quotes or curly quotes consistently. Return only JSON that follows the schema.

SECTION RULES
hangman: exactly 11 items, 6 with type "fill" and 5 with type "guess".
  - fill: "sentence" uses would like / ask / tell and contains exactly one "___" that replaces ONE word; "answer" is that word.
  - guess: "topic" is a short category (2-4 words); "sentence" is a clue that uses would like / ask / tell and does NOT contain the answer;
    "answer" is a vocabulary word or a two-word term from the topic.
  - "answer": letters and at most one space, no hyphens or numbers, max 14 letters. "hint": one short helpful sentence that does not reveal the answer.
matching: exactly 8 pairs.
  - "said": what someone said in direct speech with speaker and listener, e.g. "Please don't restart the server," the admin said to us.
    For would like items use a polite wish such as: "I want a quiet room." (said politely)
  - "reported": the same idea with asked/told + person + (not) to + verb, or would like (not) to + verb.
  - Use "please"/"can you" for requests (asked) and imperatives for orders (told) so each pair is clear. Every "reported" must match only one "said".
fill: exactly 15 items: 8 with mode "drag" and 7 with mode "type".
  - "sentence" contains exactly two "___" gaps.
  - "context": one short line (direct speech or a situation) that makes the correct answer clear, e.g. "Don't share the password!" Security said to us.
  - "gap1" and "gap2": every accepted answer for that gap, in lowercase.
  - drag items: each gap answer is exactly ONE word (e.g. "told", "not", "to", "would", "like", "me", or a topic verb).
  - type items: a gap answer can be 1-3 words (e.g. "not to store"). Accept "asked" and "told" both only when the context does not decide.
distractors: 6 single lowercase words that look possible but fit no gap (e.g. "tell", "no", "sharing").
cards: exactly 10 conversation cards: 4 "Speak", 2 "Be polite", 2 "Report it", 2 "Fix the mistake".
  - "question": an open question about the topic that the student answers with the target grammar.
    "Report it": give direct speech and ask the student to report it with ask or tell.
    "Fix the mistake": the question is "Find and fix the mistake:" followed by a sentence with ONE typical error.
  - "formula": the grammar formula to use, e.g. "tell + person + not to + verb".
  - "hintLabel": "Start like this" (then "hint" is a sentence starter with ___ blanks) or "Tip" (then "hint" explains what to look at, without giving the answer).
  - "words": 0-6 useful words or phrases from the topic.
  - "answer": one possible model answer (students may answer differently).`;

const STR = { type: 'STRING' };
const LIST = { type: 'ARRAY', items: STR };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    hangman: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      type: { type: 'STRING', enum: ['fill', 'guess'] }, topic: STR, sentence: STR, answer: STR, hint: STR
    }, required: ['type', 'sentence', 'answer', 'hint'] } },
    matching: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      said: STR, reported: STR
    }, required: ['said', 'reported'] } },
    fill: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      mode: { type: 'STRING', enum: ['drag', 'type'] }, context: STR, sentence: STR, gap1: LIST, gap2: LIST
    }, required: ['mode', 'context', 'sentence', 'gap1', 'gap2'] } },
    distractors: LIST,
    cards: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      tag: { type: 'STRING', enum: ['Speak', 'Be polite', 'Report it', 'Fix the mistake'] },
      question: STR, formula: STR, hintLabel: { type: 'STRING', enum: ['Start like this', 'Tip'] },
      hint: STR, words: LIST, answer: STR
    }, required: ['tag', 'question', 'formula', 'hintLabel', 'hint', 'words', 'answer'] } }
  },
  required: ['hangman', 'matching', 'fill', 'distractors', 'cards']
};

const FOCUS = {
  mixed: 'Mix positive (to + verb) and negative (not to + verb) sentences, about half and half.',
  positive: 'Use only positive forms (to + verb). Do not use negative infinitives.',
  negative: 'Use mostly negative forms (not to + verb), about 80% of the items.'
};

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : (ok ? origin : 'null'),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    }
  };
}

const reply = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
    if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405, cors.headers);
    if (!cors.ok) return reply({ error: 'This page is not allowed to use the AI server. Add its address to ALLOWED_ORIGINS.' }, 403, cors.headers);
    if (!env.GEMINI_API_KEY) return reply({ error: 'The AI server has no GEMINI_API_KEY yet.' }, 500, cors.headers);

    let body;
    try { body = await request.json(); } catch { return reply({ error: 'Invalid request.' }, 400, cors.headers); }
    const topic = clean(body.topic, 80);
    const vocab = clean(body.vocab, 600);
    const level = ['A2', 'B1', 'B2'].includes(body.level) ? body.level : 'B1';
    const focus = FOCUS[body.focus] ? body.focus : 'mixed';
    if (!topic) return reply({ error: 'Write a topic first.' }, 400, cors.headers);

    const prompt = [
      `Topic: ${topic}`,
      `CEFR level: ${level}`,
      vocab ? `Vocabulary to include (use as many as possible, spread across all sections): ${vocab}` : 'Vocabulary: choose 10-15 useful words for this topic and use them across all sections.',
      `Grammar focus: ${FOCUS[focus]}`,
      'Create the full set of activities now.'
    ].join('\n');

    const model = clean(env.GEMINI_MODEL, 60) || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const payload = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json', responseSchema: SCHEMA }
    };

    let res, data;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(payload)
      });
      data = await res.json().catch(() => null);
    } catch {
      return reply({ error: 'Could not reach Gemini. Try again in a moment.' }, 502, cors.headers);
    }

    if (!res.ok) {
      const detail = data?.error?.message || '';
      if (res.status === 429) return reply({ error: 'The free Gemini quota is used up for now. Wait a minute and try again.', detail }, 429, cors.headers);
      if (res.status === 400 || res.status === 401 || res.status === 403) return reply({ error: 'Gemini rejected the request. Check the API key and the model name in the Worker settings.', detail }, 502, cors.headers);
      return reply({ error: 'Gemini returned an error. Try again.', detail }, 502, cors.headers);
    }

    const text = (data?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    let content;
    try { content = JSON.parse(text); } catch {
      return reply({ error: 'The AI answer could not be read. Please try again.' }, 502, cors.headers);
    }
    return reply({ topic, content }, 200, cors.headers);
  }
};
