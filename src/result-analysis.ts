import type * as ts from "typescript";

export interface Result_Analysis {
  ok_value_types: ts.Type[];
  error_types: ts.Type[];
}

export interface Unwrapped_Return {
  inner: ts.Type;
  is_async: boolean;
}

export function unwrap_promise(checker: ts.TypeChecker, type: ts.Type): Unwrapped_Return {
  const symbol = type.getSymbol?.();
  if (symbol?.getName() === "Promise") {
    const type_args = checker.getTypeArguments(type as ts.TypeReference);
    if (type_args?.length === 1) {
      return { inner: type_args[0], is_async: true };
    }
  }
  return { inner: type, is_async: false };
}

// Structurally detects a union of { is_ok: boolean literal; value; error }
// members -- the shape of @thomasefbland/std's Result type. Returns null if
// `type` doesn't match.
export function analyze_result_union(checker: ts.TypeChecker, type: ts.Type, ts_: typeof ts): Result_Analysis | null {
  const members = type.isUnion() ? type.types : [type];
  const ok_value_types: ts.Type[] = [];
  const error_types: ts.Type[] = [];

  for (const member of members) {
    if (!(member.flags & ts_.TypeFlags.Object)) return null;

    const props = member.getProperties();
    if (props.length !== 3) return null;

    const is_ok_prop = member.getProperty("is_ok");
    const value_prop = member.getProperty("value");
    const error_prop = member.getProperty("error");
    if (!is_ok_prop || !value_prop || !error_prop) return null;

    const is_ok_type = checker.getTypeOfSymbol(is_ok_prop);
    if (!(is_ok_type.flags & ts_.TypeFlags.BooleanLiteral)) return null;
    const is_ok = checker.typeToString(is_ok_type) === "true";

    if (is_ok) ok_value_types.push(checker.getTypeOfSymbol(value_prop));
    else error_types.push(checker.getTypeOfSymbol(error_prop));
  }

  if (ok_value_types.length === 0 && error_types.length === 0) return null;
  return { ok_value_types, error_types };
}

export function dedupe_type_strings(checker: ts.TypeChecker, types: ts.Type[], enclosing_node: ts.Node | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of types) {
    const str = checker.typeToString(t, enclosing_node);
    if (str === "never") continue;
    if (!seen.has(str)) {
      seen.add(str);
      out.push(str);
    }
  }
  return out;
}
