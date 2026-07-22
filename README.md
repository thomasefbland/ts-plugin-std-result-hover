# @thomasefbland/ts-plugin-std-result

TypeScript language-service plugin that collapses `Result`/`Async_Result` types from `@thomasefbland/std` into their clean generic form instead of the raw expanded union.

## Before / After

**Before** (raw TypeScript hover):

```
function safe_parse(s: string): {
    readonly is_ok: true;
    readonly value: JSON_Value;
    readonly error: undefined;
} | {
    readonly is_ok: false;
    readonly value: never;
    readonly error: Safe_Syntax_Error;
} | {
    readonly is_ok: false;
    readonly value: never;
    readonly error: Unknown_Error;
}
```

**After** (with this plugin):

```
function safe_parse(s: string): Result<JSON_Value, Safe_Syntax_Error | Unknown_Error>
```

For async functions returning `Promise<Result<...>>`, the display is rewritten to use `Async_Result<...>`.

## What This Rewrites

- **Hover** (shift+K) — function signatures and variable types
- **Completion docs** — the detail popup when selecting a completion item
- **Signature help** — the parameter hint shown inside function call parens
- **Inlay hints** — the inferred return type annotations shown inline

## Lint Diagnostics

Emits an error when a function mixes `Result`/`Async_Result` returns with other types:

```ts
// Error: not all returns are Result or Async_Result
function safe_parse(s: string) {
  try {
    return Ok<JSON_Value>(JSON.parse(s));
  } catch (e) {
    return 0; // <- not a Result
  }
}
```

## How It Works

Matching is based on a `declare readonly '~tag': "@thomasefbland:result"` property on the `Result` type from `@thomasefbland/std`. Only types with this brand marker are collapsed — other `{ is_ok, value, error }` shapes are left untouched.

## Limitations

- Only affects display — never touches `tsc`, type-checking, or builds.
- Lint errors are shown to the LSP but do not stop ts compilation.
- Purely cosmetic display change for QOL.

## License

MIT
