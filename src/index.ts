import type * as ts_types from "typescript/lib/tsserverlibrary";
import { analyze_result_union, dedupe_type_strings, unwrap_promise } from "./result-analysis";
import { format_result_type, split_signature_text } from "./hover-format";

function init(modules: { typescript: typeof ts_types }) {
  const ts = modules.typescript;

  function find_node_at_position(source_file: ts_types.SourceFile, position: number): ts_types.Node | undefined {
    function find(node: ts_types.Node): ts_types.Node | undefined {
      if (position >= node.getStart(source_file) && position < node.getEnd()) {
        return ts.forEachChild(node, find) || node;
      }
      return undefined;
    }
    return find(source_file);
  }

  function get_display_parts_text(parts: ts_types.SymbolDisplayPart[] | undefined): string {
    return parts ? parts.map((p) => p.text).join("") : "";
  }

  function try_rewrite_return_type(checker: ts_types.TypeChecker, signature: ts_types.Signature, enclosing_node: ts_types.Node): string | null {
    const return_type = checker.getReturnTypeOfSignature(signature);
    const unwrapped = unwrap_promise(checker, return_type);
    const analyzed = analyze_result_union(checker, unwrapped.inner, ts);
    if (!analyzed) return null;

    const t_strings = dedupe_type_strings(checker, analyzed.ok_value_types, enclosing_node);
    const e_strings = dedupe_type_strings(checker, analyzed.error_types, enclosing_node);
    return format_result_type(unwrapped.is_async, t_strings, e_strings);
  }

  function rewrite_display_parts_for_result(display_parts: ts_types.SymbolDisplayPart[], checker: ts_types.TypeChecker, node: ts_types.Node): ts_types.SymbolDisplayPart[] {
    const text = get_display_parts_text(display_parts);
    const prefix = split_signature_text(text);
    if (!prefix) return display_parts;

    const type = checker.getTypeAtLocation(node);
    const signatures = type.getCallSignatures();
    for (const signature of signatures) {
      const rewritten = try_rewrite_return_type(checker, signature, node);
      if (rewritten) {
        return [{ kind: "text", text: prefix + rewritten }];
      }
    }
    return display_parts;
  }

  function rewrite_suffix_for_result(suffix_parts: ts_types.SymbolDisplayPart[], checker: ts_types.TypeChecker, node: ts_types.Node): ts_types.SymbolDisplayPart[] {
    const text = get_display_parts_text(suffix_parts);
    const colon_idx = text.indexOf(": ");
    if (colon_idx === -1) return suffix_parts;

    const type = checker.getTypeAtLocation(node);
    const signatures = type.getCallSignatures();
    for (const signature of signatures) {
      const rewritten = try_rewrite_return_type(checker, signature, node);
      if (rewritten) {
        return [
          { kind: "punctuation", text: text.slice(0, colon_idx + 2) },
          { kind: "text", text: rewritten },
        ];
      }
    }
    return suffix_parts;
  }

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

        prior.displayParts = rewrite_display_parts_for_result(prior.displayParts, checker, node);
      } catch {}

      return prior;
    };

    proxy.getCompletionEntryDetails = (fileName, position, entryName, formatOptions, source, preferences, data) => {
      const prior = info.languageService.getCompletionEntryDetails(fileName, position, entryName, formatOptions, source, preferences, data);
      if (!prior) return prior;

      try {
        const program = info.languageService.getProgram();
        const source_file = program?.getSourceFile(fileName);
        if (!program || !source_file) return prior;

        const checker = program.getTypeChecker();
        const node = find_node_at_position(source_file, position);
        if (!node) return prior;

        prior.displayParts = rewrite_display_parts_for_result(prior.displayParts, checker, node);
        if (prior.documentation) {
          prior.documentation = rewrite_display_parts_for_result(prior.documentation, checker, node);
        }
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

        for (const item of prior.items) {
          item.suffixDisplayParts = rewrite_suffix_for_result(item.suffixDisplayParts, checker, node);
        }
      } catch {}

      return prior;
    };

    return proxy;
  }

  return { create };
}

export = init;
