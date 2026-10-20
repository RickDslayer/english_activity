/**
 * Cloudflare Worker: generates the activities for the English grammar games page with Gemini.
 *
 * Variables (Cloudflare dashboard → your Worker → Settings → Variables and Secrets):
 *   GEMINI_API_KEY   (type: Secret)  your Gemini API key. NEVER put it in index.html.
 *   ALLOWED_ORIGINS  (type: Text)    comma-separated page addresses allowed to call this Worker,
 *                                    e.g. https://youruser.github.io   ("*" = any site; only for testing)
 *   GEMINI_MODEL     (type: Text)    the Gemini model code, e.g. gemini-3.5-flash-lite
 *
 * Request body (JSON): { grammar, vocab, words, level }
 *   grammar  grammar topic, e.g. "Present continuous", "Past perfect", "Modal verbs"
 *   vocab    vocabulary theme, e.g. "Vegetables", "IT and computers"
 *   words    optional comma-separated words to include
 *   level    A1 | A2 | B1 | B2 | C1
 */

const SYSTEM = `You create English (ESL) practice games for students.
The user gives a GRAMMAR TOPIC (for example: present continuous, past perfect, modal verbs, first conditional)
and a VOCABULARY THEME (for example: vegetables, IT and computers, travel).
Every item must practise the grammar topic AND use words from the vocabulary theme.
All English must be natural and grammatically perfect at the requested CEFR level.
If the grammar topic is unclear, use the closest English grammar point. Write everything in English.
Return only JSON that follows the schema.

SECTION RULES
hangman: exactly 11 items, 6 with type "fill" and 5 with type "guess".
  - fill: "sentence" practises the grammar topic and contains exactly one "___" that replaces ONE key grammar word
    (a verb form, auxiliary, modal, etc.). "answer" is that word. When needed to make the answer clear, put the base verb
    in brackets right after the gap. Examples: "She is ___ (cook) the carrots right now." -> "cooking";
    "They ___ eaten the salad before we arrived." -> "had".
  - guess: "topic" is the vocabulary theme as a short category (2-4 words); "sentence" is a clue that uses the grammar topic
    and does NOT contain the answer; "answer" is a word or two-word term from the vocabulary theme.
  - "answer": letters and at most one space only (no apostrophes, hyphens or numbers), max 14 letters.
  - "hint": one short helpful sentence that does not reveal the answer.
matching: exactly 8 pairs, plus "matchingLabels" with short column titles (2-6 words each) for the left and right columns.
  - Choose the pairing type that best practises the grammar topic, for example: sentence beginning -> correct ending;
    question -> correct short answer; situation -> sentence that uses the grammar; base sentence -> the same sentence transformed.
  - Each "right" item must fit only ONE "left" item, by grammar and by meaning. Use the vocabulary theme.
fill: exactly 15 items: 8 with mode "drag" and 7 with mode "type".
  - "sentence" contains exactly two "___" gaps that both test the grammar topic.
  - "context": one short line that makes the answers unambiguous: a situation, a time expression, or the base words in brackets
    like "(cook / not eat)".
  - "gap1" and "gap2": every accepted answer for that gap, in lowercase. Add common contractions as extra answers when natural
    (e.g. "is not" and "isn't").
  - drag items: each gap answer is exactly ONE word.
  - type items: a gap answer can be 1-3 words (e.g. "had eaten").
distractors: 6 single lowercase words that look possible but are wrong for every gap (for example wrong verb forms).
cards: exactly 10 conversation cards: 4 "Speak", 2 "Describe", 2 "Transform it", 2 "Fix the mistake".
  - Speak: an open personal question about the vocabulary theme that the student answers using the grammar topic.
  - Describe: ask the student to describe a situation (given in words) using the grammar topic.
  - Transform it: give a sentence and ask the student to change it (negative, question, another form) as fits the grammar topic.
  - Fix the mistake: "Find and fix the mistake:" followed by a sentence with ONE typical error for this grammar topic.
  - "formula": the grammar formula to use, e.g. "subject + am/is/are + verb-ing".
  - "hintLabel": "Start like this" (then "hint" is a sentence starter with ___ blanks) or "Tip" (then "hint" explains what to look at,
    without giving the answer).
  - "words": 0-6 useful words or phrases from the vocabulary theme.
  - "answer": one possible model answer (students may answer differently).`;

const STR = { type: 'STRING' };
const LIST = { type: 'ARRAY', items: STR };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    hangman: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      type: { type: 'STRING', enum: ['fill', 'guess'] }, topic: STR, sentence: STR, answer: STR, hint: STR
    }, required: ['type', 'sentence', 'answer', 'hint'] } },
    matchingLabels: { type: 'OBJECT', properties: { left: STR, right: STR }, required: ['left', 'right'] },
    matching: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      left: STR, right: STR
    }, required: ['left', 'right'] } },
    fill: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      mode: { type: 'STRING', enum: ['drag', 'type'] }, context: STR, sentence: STR, gap1: LIST, gap2: LIST
    }, required: ['mode', 'context', 'sentence', 'gap1', 'gap2'] } },
    distractors: LIST,
    cards: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      tag: { type: 'STRING', enum: ['Speak', 'Describe', 'Transform it', 'Fix the mistake'] },
      question: STR, formula: STR, hintLabel: { type: 'STRING', enum: ['Start like this', 'Tip'] },
      hint: STR, words: LIST, answer: STR
    }, required: ['tag', 'question', 'formula', 'hintLabel', 'hint', 'words', 'answer'] } }
  },
  required: ['hangman', 'matchingLabels', 'matching', 'fill', 'distractors', 'cards']
};

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
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
    const grammar = clean(body.grammar, 80);
    const vocab = clean(body.vocab, 80) || 'everyday life';
    const words = clean(body.words, 600);
    const level = LEVELS.includes(body.level) ? body.level : 'B1';
    if (!grammar) return reply({ error: 'Write a grammar topic first.' }, 400, cors.headers);

    const prompt = [
      `GRAMMAR TOPIC: ${grammar}`,
      `VOCABULARY THEME: ${vocab}`,
      words ? `Words that must appear (spread them across all sections): ${words}` : 'Choose 12-15 useful words for the vocabulary theme and use them across all sections.',
      `CEFR level: ${level}`,
      'Create the full set of activities now.'
    ].join('\n');

    const model = clean(env.GEMINI_MODEL, 60) || 'gemini-3.5-flash-lite';
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
      console.log('Gemini error', res.status, detail);
      if (res.status === 429) return reply({ error: 'The free Gemini quota is used up for now. Wait a minute and try again.', detail }, 429, cors.headers);
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) return reply({ error: 'Gemini rejected the request. Check the API key and the model name in the Worker settings.', detail }, 502, cors.headers);
      return reply({ error: 'Gemini returned an error. Try again.', detail }, 502, cors.headers);
    }

    const text = (data?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    let content;
    try { content = JSON.parse(text); } catch {
      return reply({ error: 'The AI answer could not be read. Please try again.' }, 502, cors.headers);
    }
    return reply({ grammar, vocab, content }, 200, cors.headers);
  }
};
