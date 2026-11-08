"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { configuration } from "@/lib/admin/settings";
import { settingLabels, legalLabels } from "@/lib/admin/labels";
import { useAdminSave } from "./save";
type Config = Awaited<ReturnType<typeof configuration>>;
const field =
  "mt-1 block min-h-11 w-full rounded-lg border border-stone-300 bg-white p-3 text-sm";
function Result({ message, failed }: { message: string; failed: boolean }) {
  return message ? (
    <p role={failed ? "alert" : "status"} className="my-3 text-sm">
      {message}
    </p>
  ) : null;
}
function PlanForm({ plan }: { plan: Config["plans"][number] }) {
  const { save, ...state } = useAdminSave(),
    [revision, setRevision] = useState(plan.editRevision);
  return (
    <form
      className="rounded-2xl border bg-white p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          price = String(f.get("price")).replace(",", ".");
        if (!/^\d+(\.\d{1,2})?$/.test(price)) return;
        const r = await save(`plans/${plan.id}`, {
          revision,
          title: f.get("title"),
          priceKopecks: Math.round(Number(price) * 100),
          tutorDailyLimit: Number(f.get("limit")),
          features: String(f.get("features"))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          order: Number(f.get("order")),
          isActive: f.has("active"),
        });
        if (r) setRevision(r.editRevision);
      }}
    >
      <h2 className="text-xl font-semibold">{plan.title}</h2>
      <p className="my-3 text-sm">
        {plan.kind === "FREE"
          ? "Бесплатный доступ"
          : "Оплата за " +
            plan.periodMonths +
            " мес. Цена действующих подписок сохраняется."}
      </p>
      <label className="block text-sm">
        Название тарифа
        <input
          name="title"
          required
          maxLength={150}
          defaultValue={plan.title}
          className={field}
        />
      </label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Цена, ₽
          <input
            name="price"
            inputMode="decimal"
            required
            pattern="[0-9]+([.,][0-9]{1,2})?"
            defaultValue={(plan.priceKopecks / 100).toFixed(2)}
            className={field}
          />
        </label>
        <label className="text-sm">
          Вопросов ИИ в день
          <input
            name="limit"
            type="number"
            min={0}
            max={100000}
            required
            defaultValue={plan.tutorDailyLimit}
            className={field}
          />
        </label>
      </div>
      <label className="mt-4 block text-sm">
        Возможности — каждая с новой строки
        <textarea
          name="features"
          defaultValue={plan.features.join("\n")}
          rows={4}
          className={field}
        />
      </label>
      <label className="mt-4 block text-sm">
        Порядок показа
        <input
          name="order"
          type="number"
          min={0}
          max={10000}
          required
          defaultValue={plan.order}
          className={field}
        />
      </label>
      <label className="my-4 flex min-h-11 items-center gap-3 text-sm">
        <input name="active" type="checkbox" defaultChecked={plan.isActive} />
        Тариф доступен для новых подключений
      </label>
      <Result {...state} />
      <button className="lesson-primary" disabled={state.busy}>
        Сохранить тариф
      </button>
    </form>
  );
}
function SettingForm({ row }: { row: Config["settings"][number] }) {
  const { save, ...state } = useAdminSave(),
    [revision, setRevision] = useState(row.revision);
  return (
    <form
      className="rounded-xl border bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const raw = String(new FormData(e.currentTarget).get("value")),
          value = Array.isArray(row.value)
            ? raw.split(",").map(Number)
            : Number(raw);
        const r = await save("settings", { key: row.key, revision, value });
        if (r) setRevision(r.revision);
      }}
    >
      <label className="block text-sm">
        {settingLabels[row.key] ?? row.key}
        <input
          className={field}
          name="value"
          required
          type={Array.isArray(row.value) ? "text" : "number"}
          step="any"
          defaultValue={
            Array.isArray(row.value) ? row.value.join(", ") : String(row.value)
          }
        />
      </label>
      <Result {...state} />
      <button
        className="mt-3 min-h-11 text-sm text-emerald-800 underline"
        disabled={state.busy}
      >
        Сохранить настройку
      </button>
    </form>
  );
}
function LandingForm({ initial }: { initial: Config["landing"] }) {
  const { save, ...state } = useAdminSave(),
    [value, setValue] = useState(initial.value),
    [revision, setRevision] = useState(initial.revision);
  const labels = {
    brand: "Название в шапке",
    title: "Заголовок главной",
    description: "Описание",
    demoCta: "Кнопка знакомства",
    disclaimer: "Учебное предупреждение",
    paymentNote: "Примечание к оплате",
  };
  return (
    <form
      className="space-y-5 rounded-2xl border bg-white p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const { examples: _, ...texts } = value;
        void _;
        const r = await save("landing", { revision, value: texts });
        if (r) setRevision(r.revision);
      }}
    >
      <h2 className="text-xl font-semibold">Главная страница и FAQ</h2>
      {Object.entries(labels).map(([key, label]) => (
        <label key={key} className="block text-sm">
          {label}
          <textarea
            className={field}
            required
            maxLength={4000}
            rows={2}
            value={value[key as keyof typeof labels]}
            onChange={(e) => setValue({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
      <label className="block text-sm">
        Преимущества — каждое с новой строки
        <textarea
          className={field}
          rows={4}
          value={value.benefits.join("\n")}
          onChange={(e) =>
            setValue({ ...value, benefits: e.target.value.split("\n") })
          }
        />
      </label>
      {(["how", "inside"] as const).map((key) => (
        <fieldset key={key} className="space-y-3">
          <legend className="font-semibold">
            {key === "how" ? "Как устроено обучение" : "Что внутри"}
          </legend>
          {value[key].map((item, i) => (
            <div key={i} className="rounded-xl border p-3">
              <label className="text-sm">
                Заголовок {i + 1}
                <input
                  className={field}
                  required
                  maxLength={300}
                  value={item.title}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      [key]: value[key].map((p, n) =>
                        n === i ? { ...p, title: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
              <label className="text-sm">
                Описание {i + 1}
                <textarea
                  className={field}
                  required
                  maxLength={4000}
                  value={item.text}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      [key]: value[key].map((p, n) =>
                        n === i ? { ...p, text: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
        </fieldset>
      ))}
      <fieldset className="space-y-4">
        <legend className="font-semibold">Частые вопросы</legend>
        {value.faq.map((f, i) => (
          <div key={i} className="rounded-xl border p-4">
            <label className="text-sm">
              Вопрос {i + 1}
              <input
                className={field}
                required
                maxLength={500}
                value={f.question}
                onChange={(e) =>
                  setValue({
                    ...value,
                    faq: value.faq.map((p, n) =>
                      n === i ? { ...p, question: e.target.value } : p,
                    ),
                  })
                }
              />
            </label>
            <label className="text-sm">
              Ответ {i + 1}
              <textarea
                className={field}
                required
                maxLength={4000}
                rows={3}
                value={f.answer}
                onChange={(e) =>
                  setValue({
                    ...value,
                    faq: value.faq.map((p, n) =>
                      n === i ? { ...p, answer: e.target.value } : p,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="min-h-11 text-sm underline"
              onClick={() =>
                setValue({ ...value, faq: value.faq.filter((_, n) => n !== i) })
              }
            >
              Убрать вопрос {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="min-h-11 underline"
          disabled={value.faq.length >= 20}
          onClick={() =>
            setValue({
              ...value,
              faq: [...value.faq, { question: "", answer: "" }],
            })
          }
        >
          Добавить вопрос
        </button>
      </fieldset>
      <Result {...state} />
      <button className="lesson-primary" disabled={state.busy}>
        Сохранить главную страницу
      </button>
    </form>
  );
}
function BillingText({ initial }: { initial: Config["billing"] }) {
  const { save, ...state } = useAdminSave(),
    [value, setValue] = useState(initial.value),
    [revision, setRevision] = useState(initial.revision);
  const labels = {
    version: "Версия согласия",
    renewal: "Согласие на автопродление",
    mockNotice: "Сообщение тестовой оплаты",
    testShopNotice: "Сообщение тестового магазина",
    paid: "Письмо об оплате",
    failed: "Письмо о неудаче",
    canceled: "Письмо об отмене",
    expired: "Письмо об окончании",
    reminder: "Письмо о предстоящем списании",
    refunded: "Письмо о возврате",
    refundedExtra: "Письмо о возврате лишнего списания",
  };
  return (
    <form
      className="mt-6 space-y-4 rounded-2xl border bg-white p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await save("billing-text", { revision, value });
        if (r) setRevision(r.revision);
      }}
    >
      <h2 className="text-xl font-semibold">Оплата и письма</h2>
      <p className="text-sm">
        Изменяя согласие, укажите новую версию. Готовые юридические формулировки
        согласуйте с юристом.
      </p>
      {Object.entries(labels).map(([key, label]) => (
        <label key={key} className="block text-sm">
          {label}
          <textarea
            required
            maxLength={4000}
            className={field}
            value={value[key as keyof typeof labels]}
            onChange={(e) => setValue({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
      <Result {...state} />
      <button className="lesson-primary" disabled={state.busy}>
        Сохранить тексты оплаты
      </button>
    </form>
  );
}
function LegalForm({ documents }: { documents: Config["documents"] }) {
  const { save, ...state } = useAdminSave(),
    router = useRouter(),
    [kind, setKind] = useState("oferta"),
    [version, setVersion] = useState(""),
    [text, setText] = useState(
      documents.find((d) => d.kind === "oferta")?.contentMd ?? "",
    ),
    [confirm, setConfirm] = useState(false);
  const current = documents.find((d) => d.kind === kind);
  return (
    <>
      <form
        className="space-y-5 rounded-2xl border bg-white p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await save("legal", {
            kind,
            version,
            contentMd: text,
            previousId: current?.id ?? null,
            confirm,
          });
          if (r) {
            setVersion("");
            setConfirm(false);
            router.refresh();
          }
        }}
      >
        <h2 className="text-xl font-semibold">Новая версия документа</h2>
        <p className="text-sm leading-7">
          Старые версии сохраняются. Новая оферта или согласие потребуют
          повторного подтверждения при следующем входе. Здесь размещают
          подготовленные юридические тексты.
        </p>
        <label className="block text-sm">
          Документ
          <select
            className={field}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setText(
                documents.find((d) => d.kind === e.target.value)?.contentMd ??
                  "",
              );
              setVersion("");
              setConfirm(false);
            }}
          >
            {Object.entries(legalLabels).map(([value, title]) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm">Текущая версия: {current?.version ?? "Нет"}</p>
        <label className="block text-sm">
          Номер новой версии
          <input
            className={field}
            required
            maxLength={80}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Текст документа
          <textarea
            className={field}
            rows={18}
            required
            minLength={10}
            maxLength={100000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          Подтверждаю размещение новой версии для пользователей
        </label>
        <Result {...state} />
        <button className="lesson-primary" disabled={state.busy || !confirm}>
          Разместить новую версию
        </button>
      </form>
      <section className="mt-7">
        <h2 className="text-xl font-semibold">История версий</h2>
        <ul className="mt-4 space-y-3">
          {documents.map((d) => (
            <li key={d.id} className="rounded-xl border bg-white p-4">
              <details>
                <summary className="cursor-pointer">
                  {legalLabels[d.kind] ?? d.kind} · {d.version} ·{" "}
                  {d.publishedAt.slice(0, 10)}
                </summary>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-7">
                  {d.contentMd}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
export function Configuration({
  data,
  section,
}: {
  data: Config;
  section: string;
}) {
  if (section === "plans")
    return (
      <div className="grid gap-5 lg:grid-cols-3">
        {data.plans.map((p) => (
          <PlanForm key={p.id} plan={p} />
        ))}
      </div>
    );
  if (section === "limits")
    return (
      <>
        <p className="mb-5 text-sm leading-7">
          Лимиты вопросов для бесплатного и платных тарифов меняются в разделе
          «Тарифы». Базовые лимиты ниже используются при отсутствии тарифной
          настройки и для вручную выданного доступа.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {data.settings.map((row) => (
            <SettingForm key={row.key} row={row} />
          ))}
        </div>
      </>
    );
  if (section === "legal") return <LegalForm documents={data.documents} />;
  return (
    <>
      <LandingForm initial={data.landing} />
      <BillingText initial={data.billing} />
    </>
  );
}
