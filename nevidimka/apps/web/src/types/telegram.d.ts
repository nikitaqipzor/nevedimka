export {};

declare global {
  interface TelegramWebApp {
    initData: string;
    ready: () => void;
    expand: () => void;
    setHeaderColor?: (color: string) => void;
    setBackgroundColor?: (color: string) => void;
    colorScheme?: "light" | "dark";
    platform?: string;
  }

  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}
