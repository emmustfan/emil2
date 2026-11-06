"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authRu } from "@/lib/i18n/ru";
import { inputClass } from "./shell";
export type ProfileValues = {
  name: string;
  university: string;
  course: number | null;
  timezone: string;
};
export function ProfileForm({
  initial,
  onboarding,
  versions,
  universities = [],
}: {
  initial: ProfileValues;
  onboarding?: boolean;
  versions?: { consent: string; offer: string };
  universities?: { name: string; city: string }[];
}) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const tz = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (onboarding && tz.current)
      tz.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, [onboarding]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(
        onboarding ? "/api/onboarding" : "/api/profile",
        {
          method: "POST",
          body: new URLSearchParams(
            Object.fromEntries(new FormData(event.currentTarget)) as Record<
              string,
              string
            >,
          ),
        },
      );
      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }
      const result = await response.json();
      setFailed(!response.ok);
      setMessage(response.ok ? authRu.saved : result.error);
    } catch {
      setFailed(true);
      setMessage(authRu.errors.unavailable);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block text-sm font-medium">
        {authRu.name}
        <input
          name="name"
          autoComplete="given-name"
          required
          maxLength={100}
          defaultValue={initial.name}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium">
        {authRu.university}
        <input
          name="university"
          autoComplete="organization"
          list="universities"
          maxLength={200}
          defaultValue={initial.university}
          className={inputClass}
        />
      </label>
      <datalist id="universities">
        {universities.map((item) => (
          <option key={item.name} value={item.name}>
            {item.city}
          </option>
        ))}
      </datalist>
      <label className="block text-sm font-medium">
        {authRu.course}
        <select
          name="course"
          defaultValue={initial.course ?? ""}
          className={inputClass}
        >
          <option value="">{authRu.noCourse}</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="6">{authRu.graduate}</option>
        </select>
      </label>
      <label className="block text-sm font-medium">
        {authRu.timezone}
        <input
          ref={tz}
          name="timezone"
          required
          maxLength={100}
          defaultValue={initial.timezone}
          className={inputClass}
        />
      </label>
      {onboarding && versions && (
        <div className="space-y-4 border-t border-stone-200 pt-5">
          <input type="hidden" name="consentVersion" value={versions.consent} />
          <input type="hidden" name="offerVersion" value={versions.offer} />
          <label className="flex items-start gap-3 text-sm leading-6">
            <input
              type="checkbox"
              name="consent"
              required
              className="mt-1 size-5 shrink-0 accent-emerald-800"
            />
            {authRu.consent}
          </label>
          <p className="text-sm leading-6">
            <Link
              href="/legal/consent"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-800 underline"
            >
              {authRu.consentLink}
            </Link>{" "}
            · {authRu.offer}{" "}
            <Link
              href="/legal/oferta"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-800 underline"
            >
              {authRu.offerLink}
            </Link>
            .
          </p>
          <p className="text-xs leading-5 text-stone-500">
            {authRu.legalDraft}
          </p>
        </div>
      )}
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={
            failed ? "text-sm text-red-800" : "text-sm text-emerald-800"
          }
        >
          {message}
        </p>
      )}
      <Button className="w-full" type="submit" disabled={pending}>
        {onboarding ? authRu.continue : authRu.save}
      </Button>
    </form>
  );
}
