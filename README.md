# @thomasefbland/ts-plugin-std-result-hover

TypeScript language-service plugin that collapses `Result`/`Async_Result` hover types from `@thomasefbland/std` into their clean generic form instead of the raw expanded union.

## Before / After

**Before** (raw TypeScript hover):

```
function safe_parse<T = unknown>(s: string): {
    readonly is_ok: true;
    readonly value: T;
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
function safe_parse<T = unknown>(s: string): Result<T, Safe_Syntax_Error | Unknown_Error>
```

For async functions returning `Promise<Result<...>>`, the hover is rewritten to use `Async_Result<...>`.

Also rewrites completion docs and signature help.

## Install

```bash
pnpm add -g gh:ts-plugin-std-result-hover
```

vtsls config:

```lua
vim.lsp.config('vtsls', {
  settings = {
    vtsls = {
      tsserver = {
        globalPlugins = {
          {
            name = "@thomasefbland/ts-plugin-std-result-hover",
            location = vim.fn.system("pnpm list -g --parseable @thomasefbland/ts-plugin-std-result-hover 2>/dev/null"):gsub("\n$", ""):match("([^\n]+)$"),
            enableForWorkspaceTypeScriptVersions = true,
          },
        },
      },
    },
  },
})
```

Restart tsserver after installing: `:LspRestart`.

## How It Works

Matching is purely structural — it detects the `{ is_ok, value, error }` shape. It doesn't specifically import or check for `@thomasefbland/std`'s `Result` type, so it will also fire on any other type with that same shape.

## Limitations

- Only affects hover, completion docs, and signature help — never touches `tsc`, type-checking, or builds.
- Overloaded functions: picks the first signature matching the Result shape rather than merging all overloads.
- Purely cosmetic display change.

## License

MIT
