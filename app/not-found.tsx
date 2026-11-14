import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
export default function NotFound() {
  return (
    <main className="p-10">
      <h1 className="mb-6 text-2xl">{ru.notFound}</h1>
      <Link href="/" className="underline">
        {ru.home}
      </Link>
    </main>
  );
}
