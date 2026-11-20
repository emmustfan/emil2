import { expect, it } from "vitest";
import { csv } from "../../lib/progress/csv";

it("writes a BOM, semicolon separators and Excel-safe cells", () => {
  expect(
    csv([
      ["Кириллица", "a;b", 'a"b', "a\nb", "a\rb"],
      ["=SUM(A1)", "+1", "-1", "@name", "  =1", "\t1", -1, null],
    ]),
  ).toBe(
    '\uFEFFКириллица;"a;b";"a""b";"a\nb";"a\rb"\r\n\'=SUM(A1);\'+1;\'-1;\'@name;\'  =1;\'\t1;-1;\r\n',
  );
});
