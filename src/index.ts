import type * as ts_types from "typescript/lib/tsserverlibrary";

function init(modules: { typescript: typeof ts_types }) {
  const ts = modules.typescript;

  // -- text-splice ----------------------------------------------------------

  function find_prefix_end(text: string): number | null {
    if (text.startsWith("): ")) return 3;

    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if ("({[<".includes(ch)) depth++;
      else if (")}]>".includes(ch)) {
        depth--;
        if (depth === 0 && text.substring(i + 1, 2) === ": ") {
          return i + 3;
        }
      }
    }
    const arrow_idx = text.indexOf("=> ");
    if (arrow_idx !== -1) return arrow_idx + 3;
    const colon_idx = text.indexOf(": ");
    return colon_idx !== -1 ? colon_idx + 2 : null;
  }

  function find_return_type_end(text: string): number {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if ("({[<".includes(ch)) depth++;
      else if (")}]>".includes(ch)) {
        depth--;
        if (depth === 0) {
          let j = i + 1;
          while (j < text.length && /\s/.test(text[j])) j++;
          if (text[j] === "|") {
            i = j;
            continue;
          }
          return i + 1;
        }
      }
    }
    return text.length;
  }

  // -- result-analysis ------------------------------------------------------

  interface Result_Analysis {
    ok_value_types: ts_types.Type[];
    error_types: ts_types.Type[];
  }

  interface Unwrapped_Return {
    inner: ts_types.Type;
    is_async: boolean;
  }

  function unwrap_promise(checker: ts_types.TypeChecker, type: ts_types.Type): Unwrapped_Return {
    const symbol = type.getSymbol?.();
    if (symbol?.getName() === "Promise") {
      const type_args = checker.getTypeArguments(type as ts_types.TypeReference);
      if (type_args?.length === 1) {
        return { inner: type_args[0], is_async: true };
      }
    }
    return { inner: type, is_async: false };
  }

  const RESULT_BRAND = "@thomasefbland:result";

  function analyze_result_union(checker: ts_types.TypeChecker, type: ts_types.Type): Result_Analysis | null {
    const members = type.isUnion() ? type.types : [type];
    const ok_value_types: ts_types.Type[] = [];
    const error_types: ts_types.Type[] = [];

    const first_obj = members.find((m) => !!(m.flags & ts.TypeFlags.Object));
    if (!first_obj) return null;
    const brand_prop = first_obj.getProperty("__brand");
    if (!brand_prop) return null;
    const brand_type = checker.typeToString(checker.getTypeOfSymbol(brand_prop));
    if (brand_type !== `"${RESULT_BRAND}"`) return null;

    for (const member of members) {
      if (!(member.flags & ts.TypeFlags.Object)) return null;

      const is_ok_prop = member.getProperty("is_ok");
      const value_prop = member.getProperty("value");
      const error_prop = member.getProperty("error");
      if (!is_ok_prop || !value_prop || !error_prop) return null;

      const is_ok_type = checker.getTypeOfSymbol(is_ok_prop);
      if (!(is_ok_type.flags & ts.TypeFlags.BooleanLiteral)) return null;
      const is_ok = checker.typeToString(is_ok_type) === "true";

      if (is_ok) ok_value_types.push(checker.getTypeOfSymbol(value_prop));
      else error_types.push(checker.getTypeOfSymbol(error_prop));
    }

    if (ok_value_types.length === 0 && error_types.length === 0) return null;
    return { ok_value_types, error_types };
  }

  function dedupe_type_strings(checker: ts_types.TypeChecker, types: ts_types.Type[], enclosing_node: ts_types.Node | undefined): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of types) {
      const raw = checker.typeToString(t, enclosing_node, ts.TypeFormatFlags.NoTruncation);
      const str = raw.replace(/import\("[^"]*"\)\./g, "");
      if (str === "never") continue;
      if (!seen.has(str)) {
        seen.add(str);
        out.push(str);
      }
    }
    return out;
  }

  function format_result_type(is_async: boolean, t_strings: string[], e_strings: string[]): string {
    const t_str = t_strings.length > 0 ? t_strings.join(" | ") : "void";
    const e_str = e_strings.length > 0 ? e_strings.join(" | ") : null;
    const name = is_async ? "Async_Result" : "Result";
    return e_str ? `${name}<${t_str}, ${e_str}>` : `${name}<${t_str}>`;
  }

  // -- helpers --------------------------------------------------------------

  function find_node_at_position(source_file: ts_types.SourceFile, position: number): ts_types.Node | undefined {
    function find(node: ts_types.Node): ts_types.Node | undefined {
      if (position >= node.getStart(source_file) && position <= node.getEnd()) {
        return ts.forEachChild(node, find) || node;
      }
      return undefined;
    }
    return find(source_file);
  }

  function find_enclosing_call_expression(node: ts_types.Node): ts_types.CallExpression | null {
    let current: ts_types.Node | undefined = node;
    while (current) {
      if (ts.isCallExpression(current)) return current;
      current = current.parent;
    }
    return null;
  }

  function compute_result_string_for_signature(checker: ts_types.TypeChecker, signature: ts_types.Signature, enclosing_node: ts_types.Node): string | null {
    const return_type = checker.getReturnTypeOfSignature(signature);
    const unwrapped = unwrap_promise(checker, return_type);
    const analyzed = analyze_result_union(checker, unwrapped.inner);
    if (!analyzed) return null;

    const t_strings = dedupe_type_strings(checker, analyzed.ok_value_types, enclosing_node);
    const e_strings = dedupe_type_strings(checker, analyzed.error_types, enclosing_node);
    return format_result_type(unwrapped.is_async, t_strings, e_strings);
  }

  function compute_result_string_for_type(checker: ts_types.TypeChecker, callable_type: ts_types.Type, enclosing_node: ts_types.Node): string | null {
    for (const signature of callable_type.getCallSignatures()) {
      const result = compute_result_string_for_signature(checker, signature, enclosing_node);
      if (result) return result;
    }
    return null;
  }

  function splice_return_type(parts: ts_types.SymbolDisplayPart[], merged: string): ts_types.SymbolDisplayPart[] {
    const text = parts.map((p) => p.text).join("");
    const prefix_end = find_prefix_end(text);
    if (prefix_end === null) return parts;

    const prefix = text.slice(0, prefix_end);
    const remainder = text.slice(prefix_end);
    const return_type_end = find_return_type_end(remainder);
    const suffix = remainder.slice(return_type_end);

    return [{ kind: "text", text: prefix + merged + suffix }];
  }

  // -- overload lint --------------------------------------------------------

  type Return_Kind = "result" | "async_result" | "other";

  function classify_type_kind(checker: ts_types.TypeChecker, type: ts_types.Type): Return_Kind {
    const unwrapped = unwrap_promise(checker, type);
    const analyzed = analyze_result_union(checker, unwrapped.inner);
    if (!analyzed) return "other";
    return unwrapped.is_async ? "async_result" : "result";
  }

  function classify_return_type(checker: ts_types.TypeChecker, signature: ts_types.Signature): Return_Kind {
    return classify_type_kind(checker, checker.getReturnTypeOfSignature(signature));
  }

  function collect_return_kinds(checker: ts_types.TypeChecker, body: ts_types.Block): { kind: Return_Kind; node: ts_types.ReturnStatement }[] {
    const results: { kind: Return_Kind; node: ts_types.ReturnStatement }[] = [];
    function walk(node: ts_types.Node) {
      if (ts.isReturnStatement(node) && node.expression) {
        results.push({ kind: classify_type_kind(checker, checker.getTypeAtLocation(node.expression)), node });
      }
      ts.forEachChild(node, walk);
    }
    walk(body);
    return results;
  }

  function check_overload_consistency(source_file: ts_types.SourceFile, checker: ts_types.TypeChecker): ts_types.Diagnostic[] {
    const diagnostics: ts_types.Diagnostic[] = [];

    function diagnose_mixed_returns(node: ts_types.FunctionDeclaration, returns: { kind: Return_Kind; node: ts_types.ReturnStatement }[]) {
      const kinds = new Set(returns.map((r) => r.kind));
      const has_result = kinds.has("result") || kinds.has("async_result");
      if (!has_result) return;

      for (const { kind, node: ret_stmt } of returns) {
        if (kind === "other") {
          const line = source_file.getLineAndCharacterOfPosition(ret_stmt.getStart()).line + 1;
          diagnostics.push({
            file: source_file,
            start: ret_stmt.getStart(),
            length: ret_stmt.getEnd() - ret_stmt.getStart(),
            messageText: `Found non-Result return at line ${line}`,
            category: ts.DiagnosticCategory.Error,
            code: 9999,
          });
        }
      }
    }

    function visit(node: ts_types.Node) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol) {
          if (node.body) {
            const returns = collect_return_kinds(checker, node.body);
            diagnose_mixed_returns(node, returns);
          } else {
            const declarations = symbol.getDeclarations();
            if (declarations && declarations.length > 1) {
              const kinds = new Set<Return_Kind>();
              for (const decl of declarations) {
                if (ts.isFunctionDeclaration(decl) && decl.body === undefined) {
                  const sig = checker.getSignatureFromDeclaration(decl);
                  if (sig) kinds.add(classify_return_type(checker, sig));
                }
              }
              const has_result = kinds.has("result");
              const has_async_result = kinds.has("async_result");
              const has_other = kinds.has("other");

              let message: string | null = null;
              if (has_result && has_other) {
                message = "Overloads mix Result and non-Result returns";
              } else if (has_async_result && has_other) {
                message = "Overloads mix Async_Result and non-Result returns";
              }

              if (message) {
                diagnostics.push({
                  file: source_file,
                  start: node.name.getStart(source_file),
                  length: node.name.getEnd() - node.name.getStart(source_file),
                  messageText: message,
                  category: ts.DiagnosticCategory.Error,
                  code: 9999,
                });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(source_file);
    return diagnostics;
  }

  // -- plugin ---------------------------------------------------------------

  function create(info: ts_types.server.PluginCreateInfo) {
    const proxy: ts_types.LanguageService = Object.create(null);
    for (const k of Object.keys(info.languageService) as Array<keyof ts_types.LanguageService>) {
      const orig = info.languageService[k];
      proxy[k] = (...args: unknown[]) => (orig as Function).apply(info.languageService, args);
    }

    proxy.getQuickInfoAtPosition = (fileName, position) => {
      const prior = info.languageService.getQuickInfoAtPosition(fileName, position);
      if (!prior?.displayParts) return prior;

      try {
        const program = info.languageService.getProgram();
        const source_file = program?.getSourceFile(fileName);
        if (!program || !source_file) return prior;

        const checker = program.getTypeChecker();
        const node = find_node_at_position(source_file, position);
        if (!node) return prior;

        const type = checker.getTypeAtLocation(node);

        let merged = compute_result_string_for_type(checker, type, node);

        if (!merged) {
          const unwrapped = unwrap_promise(checker, type);
          const analyzed = analyze_result_union(checker, unwrapped.inner);
          if (analyzed) {
            const t_strings = dedupe_type_strings(checker, analyzed.ok_value_types, node);
            const e_strings = dedupe_type_strings(checker, analyzed.error_types, node);
            merged = format_result_type(unwrapped.is_async, t_strings, e_strings);
          }
        }

        if (merged) prior.displayParts = splice_return_type(prior.displayParts, merged);
      } catch {}

      return prior;
    };

    proxy.getCompletionEntryDetails = (fileName, position, entryName, formatOptions, source, preferences, data) => {
      const prior = info.languageService.getCompletionEntryDetails(fileName, position, entryName, formatOptions, source, preferences, data);
      if (!prior?.displayParts) return prior;

      try {
        const program = info.languageService.getProgram();
        const source_file = program?.getSourceFile(fileName);
        if (!program || !source_file) return prior;

        const checker = program.getTypeChecker();
        const symbol = info.languageService.getCompletionEntrySymbol(fileName, position, entryName, source);
        if (!symbol) return prior;

        const node = find_node_at_position(source_file, position) ?? source_file;
        const callable_type = checker.getTypeOfSymbolAtLocation(symbol, node);
        const merged = compute_result_string_for_type(checker, callable_type, node);
        if (merged) prior.displayParts = splice_return_type(prior.displayParts, merged);
      } catch {}

      return prior;
    };

    proxy.getSignatureHelpItems = (fileName, position, options) => {
      const prior = info.languageService.getSignatureHelpItems(fileName, position, options);
      if (!prior?.items?.length) return prior;

      try {
        const program = info.languageService.getProgram();
        const source_file = program?.getSourceFile(fileName);
        if (!program || !source_file) return prior;

        const checker = program.getTypeChecker();
        const node = find_node_at_position(source_file, position);
        if (!node) return prior;

        const call_expr = find_enclosing_call_expression(node);
        if (!call_expr) return prior;

        const callable_type = checker.getTypeAtLocation(call_expr.expression);

        for (let i = 0; i < prior.items.length; i++) {
          const signature = callable_type.getCallSignatures()[i];
          if (!signature) continue;
          const merged = compute_result_string_for_signature(checker, signature, node);
          if (!merged) continue;
          prior.items[i].suffixDisplayParts = [
            { kind: "punctuation", text: "): " },
            { kind: "text", text: merged },
          ];
        }
      } catch {}

      return prior;
    };

    (proxy as any).provideInlayHints = (fileName: string, span: { start: number; length: number }, preferences: any) => {
      const prior = (info.languageService as any).provideInlayHints(fileName, span, preferences);
      if (!prior?.length) return prior;

      try {
        const program = info.languageService.getProgram();
        const source_file = program?.getSourceFile(fileName);
        if (!program || !source_file) return prior;

        const checker = program.getTypeChecker();

        for (const hint of prior) {
          if (hint.kind !== "Type") continue;

          let node = find_node_at_position(source_file, hint.position);
          if (!node) continue;

          let type = checker.getTypeAtLocation(node);
          let unwrapped = unwrap_promise(checker, type);
          let analyzed = analyze_result_union(checker, unwrapped.inner);

          if (!analyzed) {
            let current: ts_types.Node | undefined = node;
            while (current) {
              if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
                for (const sig of checker.getTypeAtLocation(current).getCallSignatures()) {
                  const ret = checker.getReturnTypeOfSignature(sig);
                  const ret_unwrapped = unwrap_promise(checker, ret);
                  const ret_analyzed = analyze_result_union(checker, ret_unwrapped.inner);
                  if (ret_analyzed) {
                    unwrapped = ret_unwrapped;
                    analyzed = ret_analyzed;
                    node = current;
                    break;
                  }
                }
                break;
              }
              current = current.parent;
            }
          }

          if (!analyzed) continue;

          const t_strings = dedupe_type_strings(checker, analyzed.ok_value_types, node);
          const e_strings = dedupe_type_strings(checker, analyzed.error_types, node);
          const merged = format_result_type(unwrapped.is_async, t_strings, e_strings);
          hint.text = merged;
          hint.displayParts = [{ kind: "text", text: merged }];
        }
      } catch {}

      return prior;
    };

    proxy.getSemanticDiagnostics = (fileName) => {
      const prior = info.languageService.getSemanticDiagnostics(fileName);

      try {
        const program = info.languageService.getProgram();
        const source_file = program?.getSourceFile(fileName);
        if (!program || !source_file) return prior;

        const checker = program.getTypeChecker();
        const new_diagnostics = check_overload_consistency(source_file, checker);
        if (new_diagnostics.length) return [...prior, ...new_diagnostics];
      } catch {}

      return prior;
    };

    return proxy;
  }

  return { create };
}

export = init;
