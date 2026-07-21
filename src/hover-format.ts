export function format_result_type(is_async: boolean, t_strings: string[], e_strings: string[]): string {
  const t_str = t_strings.length > 0 ? t_strings.join(" | ") : "void";
  const e_str = e_strings.length > 0 ? e_strings.join(" | ") : null;
  const name = is_async ? "Async_Result" : "Result";
  return e_str ? `${name}<${t_str}, ${e_str}>` : `${name}<${t_str}>`;
}

// Finds the split point right after a function signature's parameter list
// and the following ": " (e.g. after "safe_parse<T = unknown>(s: string): ").
// Falls back to splitting on "=> " for arrow-style rendered signatures.
export function split_signature_text(text: string): string | null {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0 && text.substr(i + 1, 2) === ": ") {
        return text.slice(0, i + 3);
      }
    }
  }
  const arrow_idx = text.indexOf("=> ");
  return arrow_idx !== -1 ? text.slice(0, arrow_idx + 3) : null;
}
