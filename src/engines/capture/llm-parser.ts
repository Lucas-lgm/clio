export function parseLooseJson(raw: string): unknown {
  // First try strict parse
  try { return JSON.parse(raw); } catch { /* fall through */ }
  // Strip trailing commas, unquote keys, fix single quotes
  const cleaned = raw
    .replace(/,\s*([}\]])/g, '$1')        // trailing commas before ] or }
    .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":') // unquoted keys → quoted
    .replace(/'/g, '"');                    // single quotes → double
  return JSON.parse(cleaned);
}
