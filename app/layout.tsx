import type { ReactNode } from "react";
import type { Metadata } from "next";

import "@/app/globals.css";
import { ConsoleShell } from "@/components/layout/console-shell";
import { getAuthSession } from "@/lib/server/auth-session";

export const metadata: Metadata = {
  title: "DataTalk",
  description: "用对话完成报表开发",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getAuthSession();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{session ? <ConsoleShell session={session}>{children}</ConsoleShell> : children}</body>
    </html>
  );
}
