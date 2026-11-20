export function csv(rows: (string | number | null)[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let cell = String(value ?? "");
            if (
              typeof value === "string" &&
              (/^\s*[=+@-]/u.test(cell) || /^[\t\r\n]/u.test(cell))
            )
              cell = "'" + cell;
            return /[;"\n\r]/u.test(cell)
              ? '"' + cell.replaceAll('"', '""') + '"'
              : cell;
          })
          .join(";"),
      )
      .join("\r\n") +
    "\r\n"
  );
}
