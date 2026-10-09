// Pure helpers voor @mentions in remark-tekst (geen React).

const TOKEN_END = '(?=$|\\s|[.,;:!?)])';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Het @-woord waar de caret in staat, of null. `@` moet aan het begin of na witruimte staan. */
export function findMentionQuery(text, caret) {
  const before = String(text || '').slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/** Vervangt `@query` (start..caret) door `@value` plus spatie; caret komt achter de spatie. */
export function insertMention(text, start, caret, value) {
  const head = text.slice(0, start);
  const tail = text.slice(caret);
  const needsSpace = !/^\s/.test(tail);
  const inserted = `@${value}${needsSpace ? ' ' : ''}`;
  return { text: `${head}${inserted}${tail}`, caret: head.length + inserted.length + (needsSpace ? 0 : 1) };
}

function mentionPattern(value) {
  return new RegExp(`(^|\\s)@${escapeRegExp(value)}${TOKEN_END}`);
}

/** Alleen mentions waarvan `@waarde` nog als los token in de tekst staat (zonder dubbelen). */
export function activeMentions(text, mentions) {
  const seen = new Set();
  return (Array.isArray(mentions) ? mentions : []).filter((mention) => {
    const key = `${mention.columnId}|${mention.value}`;
    if (seen.has(key) || !mentionPattern(mention.value).test(String(text || ''))) return false;
    seen.add(key);
    return true;
  });
}

/** Splitst een remark-tekst in tekst- en mention-delen voor weergave als chips. */
export function splitMentions(body, mentions) {
  const text = String(body || '');
  const values = [...new Set((mentions || []).map((m) => m.value).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (!values.length) return [{ type: 'text', value: text }];
  const pattern = new RegExp(`(^|\\s)@(${values.map(escapeRegExp).join('|')})${TOKEN_END}`, 'g');
  const parts = [];
  let last = 0;
  let match = pattern.exec(text);
  while (match) {
    const tokenStart = match.index + match[1].length;
    if (tokenStart > last) parts.push({ type: 'text', value: text.slice(last, tokenStart) });
    parts.push({ type: 'mention', value: match[2] });
    last = tokenStart + 1 + match[2].length;
    pattern.lastIndex = last;
    match = pattern.exec(text);
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}
