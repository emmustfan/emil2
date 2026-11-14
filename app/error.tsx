"use client";
import { Button } from "@/components/ui/button";
import { ru } from "@/lib/i18n/ru";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-10">
      <h1 className="mb-6 text-2xl">{ru.error}</h1>
      <Button onClick={reset}>{ru.retry}</Button>
    </main>
  );
}
