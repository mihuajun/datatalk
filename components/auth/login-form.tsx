"use client";

import { useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[52px] w-full items-center justify-center rounded-md bg-gradient-to-b from-[#2167E8] to-[#1456D4] text-base font-bold text-white shadow-[0_10px_22px_rgba(20,86,212,0.24)] transition hover:brightness-[1.04] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2167E8]/20 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          登录中
        </span>
      ) : (
        "登录"
      )}
    </button>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<"account" | "security">("account");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = typeof formData.get("username") === "string" ? formData.get("username")?.toString().trim() : "";
    const password = typeof formData.get("password") === "string" ? formData.get("password")?.toString().trim() : "";

    if (!username || !password) {
      setError("请输入账号和密码。");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        redirectTo?: string;
      };

      if (!response.ok || !result.success) {
        setError(result.message || "登录失败，请稍后重试。");
        return;
      }

      router.push(result.redirectTo || "/reports");
      router.refresh();
    } catch (requestError) {
      console.error("Login request failed", requestError);
      setError("登录服务暂时不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-12">
      <div className="flex items-start gap-[34px]" role="tablist" aria-label="登录方式">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "account"}
          onClick={() => setActiveTab("account")}
          className={`relative pb-[10px] text-base font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2167E8]/30 ${
            activeTab === "account" ? "text-[#2167E8]" : "text-[#8997AA]"
          }`}
        >
          账号登录
          {activeTab === "account" ? <span className="absolute bottom-0 left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full bg-[#2167E8]" /> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "security"}
          onClick={() => setActiveTab("security")}
          className={`pb-[10px] text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2167E8]/30 ${
            activeTab === "security" ? "font-bold text-[#2167E8]" : "text-[#8997AA]"
          }`}
        >
          安全验证
        </button>
      </div>

      {activeTab === "security" ? (
        <div className="mt-7 rounded-md border border-[#DDE5F0] bg-[#F7F9FC] px-4 py-4 text-sm leading-6 text-[#71819B]" role="tabpanel">
          登录后将根据风险状态触发二次验证，保障数据访问安全。
          <button type="button" onClick={() => setActiveTab("account")} className="mt-3 block font-semibold text-[#2167E8] hover:underline">
            返回账号登录
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 space-y-4" role="tabpanel">
          <label className="block">
            <span className="sr-only">登录账号</span>
            <div className="flex h-12 items-center justify-between rounded-md border border-[#2167E8] bg-white px-[15px] shadow-[0_4px_12px_rgba(33,103,232,0.07)] transition focus-within:ring-4 focus-within:ring-[#2167E8]/10">
              <input
                type="text"
                name="username"
                autoComplete="username"
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[#2B3A52] outline-none placeholder:text-[#8A98AC]"
                placeholder="请输入用户名"
              />
              <span className="ml-3 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#D3D6DD]" aria-hidden="true">
                <span className="h-1.5 w-1.5 rotate-45 border-l border-t border-white" />
              </span>
            </div>
          </label>

          <label className="block">
            <span className="sr-only">登录密码</span>
            <div className="flex h-12 items-center rounded-md border border-[#DDE5F0] bg-[#F7F9FC] px-[15px] transition focus-within:border-[#2167E8] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#2167E8]/10">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[#2B3A52] outline-none placeholder:text-[#8A98AC]"
                placeholder="请输入密码"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="ml-3 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#A6B2C3] transition hover:bg-[#EAF1FB] hover:text-[#2167E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2167E8]/30"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <div className="flex items-center justify-between text-xs text-[#75849A]">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" name="remember" className="h-3 w-3 rounded-[3px] border-[#B8C5D8] text-[#2167E8] focus:ring-[#2167E8]" />
              <span>记住账号</span>
            </label>
            <button type="button" className="text-[#5274A6] transition hover:text-[#2167E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2167E8]/30">
              忘记密码
            </button>
          </div>

          {error ? (
            <div className="rounded-md border border-[#FFD4DC] bg-[#FFF6F7] px-3 py-2.5 text-sm text-[#C73A55]" role="alert">
              {error}
            </div>
          ) : null}

          <SubmitButton pending={pending} />
        </form>
      )}
    </div>
  );
}
