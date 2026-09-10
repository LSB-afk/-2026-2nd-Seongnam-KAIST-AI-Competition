import type { Metadata } from "next";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/600.css";
import "@fontsource/noto-sans-kr/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "성남 타임스토리 | 문화홍보 AI PD",
  description:
    "성남의 문화를 조사하고, 사실과 상상을 구분하며, 함께 완성하는 콘텐츠 작업실",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
