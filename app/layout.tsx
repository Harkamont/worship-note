import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "워십노트 · 예배를 준비하는 악보 작업실",
  description: "이미지 악보의 키와 코드를 다듬고 송폼에 따라 악보 PNG와 가사 TXT를 출력하세요.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
