import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gestão de Ferramentas",
  description: "Painel de gestão de ferramentas — dados de demonstração (Gate UX-1A)",
};

// Aplica o tema salvo (ou a preferência do sistema) antes da primeira pintura, para evitar
// o "flash" de tema errado. Roda como script inline bloqueante — sem rede, sem framework.
const THEME_INIT_SCRIPT = `
(function () {
  var stored = null;
  var theme = null;
  try { stored = localStorage.getItem('theme'); } catch (e) {}
  if (stored === 'light' || stored === 'dark') {
    theme = stored;
  } else {
    try { theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) {}
  }
  if (theme) document.documentElement.setAttribute('data-theme', theme);
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
