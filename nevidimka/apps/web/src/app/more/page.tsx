import Link from "next/link";
import { BarChart3, Compass, History, Lightbulb, PenSquare, Settings, Video } from "lucide-react";
import { Eyebrow, Panel } from "@/components/ui";

const ITEMS = [
  { href: "/studio", label: "Студия контента", hint: "Подготовка и публикация постов", icon: PenSquare },
  { href: "/studio/video", label: "Видео-посты", hint: "Превью, подтверждение, публикация", icon: Video },
  { href: "/studio/history", label: "История публикаций", hint: "Редактировать или удалить уже опубликованное", icon: History },
  { href: "/analytics", label: "Аналитика", hint: "Выполнение плана, фокус, самочувствие", icon: BarChart3 },
  { href: "/skills", label: "Карта навыков", hint: "Прогресс по направлениям", icon: Compass },
  { href: "/ideas", label: "Хранилище идей", hint: "Мысли, отложенные без переключения", icon: Lightbulb },
  { href: "/settings", label: "Настройки", hint: "Часовой пояс и время напоминаний", icon: Settings },
];

// Deliberately NOT in the list above: /onboarding is only reachable from the
// empty states on Today and Path. Once a mission exists, create_mission
// answers 409 (one active mission per user — migration 008), so a permanent
// entry here would be a link to a dead end. Changing an existing mission is
// done in place on the Path screen instead.

export default function MorePage() {
  return (
    <div className="px-5 pt-6">
      <Eyebrow>Ещё</Eyebrow>
      <div className="mt-4 space-y-2">
        {ITEMS.map(({ href, label, hint, icon: Icon }) => (
          <Link key={href} href={href}>
            <Panel className="flex items-center gap-3">
              <Icon size={20} strokeWidth={1.75} className="shrink-0 text-brass" />
              <div>
                <div className="text-sm text-ink">{label}</div>
                <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}
