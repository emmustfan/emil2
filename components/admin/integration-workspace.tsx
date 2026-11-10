"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import { Mail, Send, Sparkles, ImageIcon, ChevronRight } from "lucide-react";
const icons = [Mail, Send, Sparkles, ImageIcon];
function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
export function IntegrationWorkspace({
  cards,
  panels,
}: {
  cards: { id: string; title: string; status: string; description: string }[];
  panels: ReactNode[];
}) {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  const active = Math.max(
    0,
    cards.findIndex((card) => hash === `#connect-${card.id}`),
  );
  const card = cards[active];
  return (
    <div className="integration-workspace">
      <nav aria-label="Сервисы платформы" className="integration-nav">
        {cards.map((item, index) => {
          const Icon = icons[index];
          return (
            <a
              href={`#connect-${item.id}`}
              key={item.id}
              aria-current={active === index ? "page" : undefined}
            >
              <Icon size={19} aria-hidden />
              <span>
                {item.title}
                <small>{item.status}</small>
              </span>
              <ChevronRight size={16} aria-hidden />
            </a>
          );
        })}
      </nav>
      <div className="integration-panel">
        <header>
          <span className="emal-eyebrow">Подключение сервиса</span>
          <h2>{card.title}</h2>
          <p className="integration-status">{card.status}</p>
          <p>{card.description}</p>
        </header>
        {panels.map((panel, index) => (
          <div key={cards[index].id} hidden={active !== index}>
            {panel}
          </div>
        ))}
      </div>
    </div>
  );
}
