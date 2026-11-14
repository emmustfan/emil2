export function ReportFilters({
  from,
  to,
  source,
  children,
}: {
  from: string;
  to: string;
  source?: string;
  children?: React.ReactNode;
}) {
  return (
    <form className="my-6 flex flex-wrap items-end gap-4">
      <label className="text-sm">
        С даты (UTC)
        <input
          className="mt-1 block min-h-11 rounded-lg border bg-white p-2"
          type="date"
          name="from"
          defaultValue={from}
        />
      </label>
      <label className="text-sm">
        По дату (UTC)
        <input
          className="mt-1 block min-h-11 rounded-lg border bg-white p-2"
          type="date"
          name="to"
          defaultValue={to}
        />
      </label>
      {source !== undefined && (
        <label className="text-sm">
          UTM-источник
          {source === "__direct__" ? (
            <select
              name="source"
              defaultValue="__direct__"
              className="mt-1 block min-h-11 rounded-lg border bg-white p-2"
            >
              <option value="__direct__">Без UTM</option>
              <option value="">Все источники</option>
            </select>
          ) : (
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border bg-white p-2"
              name="source"
              defaultValue={source}
              maxLength={100}
              placeholder="Все источники"
            />
          )}
        </label>
      )}
      {children}
      <button className="lesson-primary">Показать</button>
    </form>
  );
}
