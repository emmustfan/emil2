"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Home,
  BookOpen,
  Layers,
  MessageSquare,
  UserRound,
  CreditCard,
  Users,
  ChartNoAxesCombined,
  Settings,
  Plug,
  FileText,
  LogOut,
  Menu,
  X,
  ArrowUpRight,
} from "lucide-react";
import { Brand } from "./brand";
type Area = "admin" | "teacher" | "student" | "learn";
export function WorkspaceFrame({
  children,
  role,
  name,
  area,
  review,
}: {
  children: ReactNode;
  role?: string;
  name?: string | null;
  area: Area;
  review: ReactNode;
}) {
  const path = usePathname(),
    [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    const trigger = toggle.current;
    document.body.style.overflow = "hidden";
    const nodes = sidebar.current?.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea",
    );
    const visible = () =>
      Array.from(nodes ?? []).filter(
        (node) => node.getClientRects().length > 0,
      );
    visible()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = visible(),
        first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", trap);
      trigger?.focus();
    };
  }, [open]);
  const staff = role === "ADMIN" || role === "EDITOR",
    managing = staff && (area === "admin" || area === "teacher"),
    admin = role === "ADMIN";
  const items = managing
    ? [
        {
          href: admin ? "/admin/dashboard" : "/teacher",
          label: admin ? "Обзор и статистика" : "Мои предметы",
          icon: admin ? ChartNoAxesCombined : Home,
        },
        ...(admin
          ? [
              { href: "/admin", label: "Предметы и уроки", icon: BookOpen },
              { href: "/admin/users", label: "Пользователи", icon: Users },
              { href: "/admin/payments", label: "Платежи", icon: CreditCard },
              { href: "/admin/subscriptions", label: "Подписки", icon: Layers },
              { href: "/admin/settings", label: "Настройки", icon: Settings },
              { href: "/admin/integrations", label: "Интеграции", icon: Plug },
            ]
          : []),
        {
          href: "/admin/tutor-logs",
          label: "Логи тьютора",
          icon: MessageSquare,
        },
      ]
    : [
        {
          href: role ? "/student" : "/subjects",
          label: role ? "Сегодня" : "Предметы",
          icon: Home,
        },
        ...(role
          ? [
              { href: "/subjects", label: "Мои предметы", icon: BookOpen },
              { href: "/review", label: "Повторение", icon: Layers },
              { href: "/tutor", label: "ИИ-тьютор", icon: MessageSquare },
              {
                href: "/cabinet/subscription",
                label: "Подписка",
                icon: CreditCard,
              },
            ]
          : [
              { href: "/demo", label: "Бесплатный урок", icon: BookOpen },
              { href: "/pricing", label: "Тарифы", icon: CreditCard },
            ]),
      ];
  const roleTitle = managing
    ? admin
      ? "Кабинет администратора"
      : "Кабинет учителя"
    : role
      ? "Личный кабинет"
      : "Учебное пространство";
  function active(href: string) {
    if (href === "/admin")
      return (
        path === "/admin" ||
        path.startsWith("/admin/subjects") ||
        path.startsWith("/admin/topics") ||
        path === "/admin/imports"
      );
    if (href === "/student") return path === "/student" || path === "/cabinet";
    return path === href || path.startsWith(href + "/");
  }
  return (
    <div className="workspace-frame">
      {open && (
        <button
          className="sidebar-shade"
          aria-label="Закрыть навигацию"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label="Меню кабинета"
        id="workspace-sidebar"
        className={`workspace-sidebar ${open ? "is-open" : ""}`}
      >
        <div className="sidebar-brand">
          <Brand />
          <p>{roleTitle}</p>
          <button
            className="sidebar-close"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav
          aria-label={managing ? "Управление платформой" : "Навигация кабинета"}
        >
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon size={18} aria-hidden />
              {label}
            </Link>
          ))}
          <div className="sidebar-separator" />
          {staff && (
            <Link
              href={managing ? "/student" : admin ? "/admin" : "/teacher"}
              onClick={() => setOpen(false)}
            >
              <ArrowUpRight size={18} aria-hidden />
              {managing
                ? "Моё обучение"
                : admin
                  ? "Администратор"
                  : "Кабинет учителя"}
            </Link>
          )}
          {role ? (
            <>
              <Link
                href="/cabinet/profile"
                aria-current={path === "/cabinet/profile" ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <UserRound size={18} aria-hidden />
                Профиль
              </Link>
              <form method="POST" action="/api/auth/logout">
                <button>
                  <LogOut size={18} aria-hidden />
                  Выйти
                </button>
              </form>
            </>
          ) : (
            <Link href="/login">
              <UserRound size={18} aria-hidden />
              Войти
            </Link>
          )}
        </nav>
        <div className="sidebar-person">
          <span className="person-avatar">
            {name?.trim().slice(0, 1).toLocaleUpperCase("ru") || "Э"}
          </span>
          <div>
            <b>{name || (role ? "Мой аккаунт" : "Гость")}</b>
            <span>{roleTitle}</span>
          </div>
        </div>
        <Link href="/legal/privacy" className="sidebar-legal">
          <FileText size={13} aria-hidden />
          Конфиденциальность
        </Link>
      </aside>
      <div className="workspace-body">
        <header className="workspace-toolbar">
          <button
            ref={toggle}
            className="sidebar-toggle"
            aria-label="Открыть меню"
            aria-expanded={open}
            aria-controls="workspace-sidebar"
            onClick={() => setOpen(true)}
          >
            <Menu size={21} />
          </button>
          <span className="workspace-location">
            {roleTitle}
            <span className="location-slash">/</span>
            <span>
              {items.find((i) => active(i.href))?.label || "Материалы"}
            </span>
          </span>
          <div className="toolbar-actions">
            {review}
            <span className="toolbar-avatar" aria-hidden>
              {name?.slice(0, 1) || "Э"}
            </span>
          </div>
        </header>
        <div className="workspace-content">{children}</div>
        <footer className="workspace-footer">
          Эмаль · Учебные материалы не заменяют клинические рекомендации.
        </footer>
      </div>
    </div>
  );
}
