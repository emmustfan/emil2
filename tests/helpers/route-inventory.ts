import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
export function apiRouteInventory() {
  const root = join(process.cwd(), "app", "api");
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith("route.ts"))
    .sort()
    .map((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const exported: string[] = [];
      for (const node of source.statements) {
        if (
          !ts.canHaveModifiers(node) ||
          !ts
            .getModifiers(node)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        )
          continue;
        if (
          ts.isFunctionDeclaration(node) &&
          node.name &&
          methods.has(node.name.text)
        )
          exported.push(node.name.text);
        if (ts.isVariableStatement(node))
          for (const declaration of node.declarationList.declarations)
            if (
              ts.isIdentifier(declaration.name) &&
              methods.has(declaration.name.text)
            )
              exported.push(declaration.name.text);
      }
      return {
        pattern:
          "/api/" + file.replace(/\/route\.ts$/, "").replaceAll("\\", "/"),
        methods: exported,
      };
    });
}
export function serverPageInventory() {
  const root = join(process.cwd(), "app");
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith("page.tsx"))
    .sort()
    .map(
      (file) =>
        "/" + file.replace(/(?:\/)?page\.tsx$/, "").replaceAll("\\", "/"),
    );
}
