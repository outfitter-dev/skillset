import { createHash } from "node:crypto";
import ts from "typescript";

/** Review tripwire only: source fingerprints do not prove provider semantics. */
export function marketplaceDeclarations(text: string): Readonly<Record<string, string>> {
  const source = ts.createSourceFile("evidence.ts", text, ts.ScriptTarget.Latest, true);
  const diagnostics = (source as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length > 0) throw new Error("marketplace coverage source does not parse");
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const result: Record<string, string> = {};
  for (const statement of source.statements) {
    const names = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.map((declaration) => `variable:${declaration.name.getText(source)}`)
      : ts.isFunctionDeclaration(statement) ? [`function:${statement.name?.text ?? "anonymous"}`]
      : ts.isImportDeclaration(statement) ? [`import:${statement.moduleSpecifier.getText(source)}`]
      : ts.isExportDeclaration(statement) ? [`export:${statement.moduleSpecifier?.getText(source) ?? "local"}`]
      : ts.isInterfaceDeclaration(statement) ? [`interface:${statement.name.text}`]
      : ts.isTypeAliasDeclaration(statement) ? [`type:${statement.name.text}`]
      : [`statement:${ts.SyntaxKind[statement.kind]}`];
    const digest = marketplaceDigest(printer.printNode(ts.EmitHint.Unspecified, statement, source));
    for (const name of names) {
      if (Object.hasOwn(result, name)) throw new Error(`duplicate marketplace coverage declaration ${name}`);
      result[name] = digest;
    }
  }
  return result;
}

export function marketplaceDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
