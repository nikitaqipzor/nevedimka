"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Compass, MessageCircle, NotebookPen, MoreHorizontal } from "lucide-react";

const ITEMS = [
  { href: "/today", label: "Сегодня", icon: CalendarDays },
  { href: "/path", label: "Путь", icon: Compass },
  { href: "/mentor", label: "Наставник", icon: MessageCircle },
  { href: "/journal", label: "Дневник", icon: NotebookPen },
  { href: "/more", label: "Ещё", icon: MoreHorizontal },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-base/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href === "/more" && pathname.startsWith("/more"));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className="flex flex-col items-center gap-1 py-2.5 text-[10px] tracking-wide"
              >
                <Icon
                  size={20}
                  strokeWidth={1.75}
                  className={active ? "text-brass" : "text-ink-faint"}
                />
                <span className={active ? "text-ink" : "text-ink-faint"}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
