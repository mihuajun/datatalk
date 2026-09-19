"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  BarChart3,
  Cable,
  ChevronDown,
  Command,
  RefreshCw,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { canAccessMembersRole, getUserRoleLabel, isAdministratorRole } from "@/lib/auth/roles";
import type { AuthSession } from "@/lib/server/auth-session";
const navItems = [
  { href: "/reports", label: "报表中心", icon: BarChart3 },
  { href: "/data-sources", label: "连接器", icon: Cable },
  { href: "/members", label: "用户管理", icon: Users },
  { href: "/settings", label: "系统设置", icon: Settings2 },
];

export function ConsoleShell({ children, session }: { children: ReactNode; session: AuthSession | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const visibleNavItems = navItems.filter(({ href }) => {
    if (href === "/settings") return session ? isAdministratorRole(session.role) : false;
    if (href === "/members") return session ? canAccessMembersRole(session.role) : false;
    return href === "/reports" || href === "/data-sources";
  });
  const isReportsPage = pathname === "/reports";
  const isReportEditorPage = pathname.startsWith("/reports/editor");
  const isReportPreviewPage = pathname.startsWith("/preview/");
  const isReportViewPage = pathname.startsWith("/view/");
  const isPublicReportPage = pathname.startsWith("/link/") || pathname.startsWith("/share/");

  async function handleLogout() {
    setLoggingOut(true);

    try {
      const response = await fetch("/api/logout", { method: "POST", headers: { Accept: "application/json" } });
      const result = (await response.json()) as { redirectTo?: string };
      router.push(result.redirectTo || "/");
      router.refresh();
    } catch (error) {
      console.error("Logout request failed", error);
      setLoggingOut(false);
    }
  }

  if (isReportEditorPage) {
    return <main className="h-screen max-h-screen min-h-0 min-w-0 overflow-hidden">{children}</main>;
  }

  if (isPublicReportPage || isReportPreviewPage || isReportViewPage) {
    return <main className="min-h-screen min-w-0 overflow-x-clip">{children}</main>;
  }

  return (
    <div className="console-canvas min-h-screen text-[#17243A] lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="console-sidebar flex min-h-screen flex-col bg-[#111D31] px-5 py-7 text-white">
        <div className="console-brand flex items-center gap-3 px-1">
          <img
            src="/icon.svg"
            alt=""
            aria-hidden="true"
            className="h-11 w-11 rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.16)]"
          />
          <div>
            <div className="text-[17px] font-extrabold tracking-[-0.02em] text-white">DataTalk</div>
            <div className="mt-0.5 text-[10px] text-[#8b9ab1]">AI 驱动报表开发</div>
          </div>
        </div>

        <div className="console-primary-nav mx-1 mt-8 border-t border-white/10 pt-4">
          <nav className="space-y-1.5">
            {visibleNavItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href === "/data-sources" && pathname.startsWith("/data-sources/")) || (href === "/reports" && pathname.startsWith("/reports/editor"));

              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex h-11 items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#74a7ff]/50 ${
                    active ? "bg-[#203a68] text-[#5ea0ff] shadow-[inset_3px_0_0_#4f92ff]" : "text-[#c0cada] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {session ? (
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="mx-0 mt-auto flex min-h-[66px] w-full items-center gap-2.5 rounded-[9px] border border-white/5 bg-white/[.06] px-3 text-left transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#74a7ff]/50 disabled:cursor-wait disabled:opacity-60"
            aria-label={loggingOut ? "退出中" : `退出登录，当前用户 ${session.name || session.username}`}
            title={loggingOut ? "退出中" : "退出登录"}
          >
            <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-[#e3edff] text-xs font-bold text-[#2167E8]">
              {(session.name || session.username).slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 truncate"><span className="block text-sm font-semibold text-white">{session.name || session.username}</span><span className="mt-0.5 block text-[11px] text-[#8b9ab1]">{getUserRoleLabel(session.role)}</span></span>
            <ChevronDown className="h-4 w-4 text-[#9aabc4]" />
          </button>
        ) : null}
      </aside>

      <div className="console-main">
        {isReportsPage ? (
          <header className="console-toolbar flex items-center justify-between gap-4 px-5 sm:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#e7f2ff] text-[#2167E8]"><BarChart3 className="h-4 w-4" /></span>
              <div className="flex min-w-0 items-baseline gap-2.5"><span className="truncate text-[19px] font-extrabold tracking-[-0.03em] text-[#17243A]">报表中心</span><span className="hidden text-xs text-[#8190a5] sm:inline">用对话完成报表开发</span></div>
            </div>
            <div className="flex items-center gap-2.5">
              <label className="hidden h-9 w-[300px] items-center gap-2 rounded-[7px] border border-[#dce5f0] bg-white px-3 text-xs text-[#9aa8ba] lg:flex"><Command className="h-3.5 w-3.5" /><input className="min-w-0 flex-1 border-0 bg-transparent outline-none placeholder:text-[#9aa8ba]" placeholder="搜索报表、文件夹，或输入快捷指令" /><span className="text-[10px]">⌘ K</span></label>
              <button type="button" className="hidden h-9 w-9 items-center justify-center rounded-[7px] text-[#526174] transition hover:bg-[#f2f6fb] hover:text-[#2167E8] sm:flex" aria-label="刷新当前页面" title="刷新当前页面" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" /></button>
              <button type="button" className="hidden h-9 w-9 items-center justify-center rounded-[7px] text-[#526174] transition hover:bg-[#f2f6fb] hover:text-[#2167E8] sm:flex" aria-label="查看智能助手" title="查看智能助手"><Sparkles className="h-4 w-4" /></button>
            </div>
          </header>
        ) : null}
          <main className={isReportEditorPage || isPublicReportPage ? "min-w-0 p-0" : isReportsPage ? "min-w-0 px-4 py-5 sm:px-5 sm:py-6" : "min-w-0 px-4 py-5 sm:px-7 sm:py-6"}>{children}</main>
      </div>
    </div>
  );
}
