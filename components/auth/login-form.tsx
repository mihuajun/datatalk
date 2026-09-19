"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

function SubmitButton({ pending, pendingLabel, label }: { pending: boolean; pendingLabel: string; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[52px] w-full items-center justify-center rounded-md bg-[#2167E8] text-base font-bold text-white shadow-[0_10px_22px_rgba(20,86,212,0.20)] transition hover:bg-[#1858CC] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2167E8]/20 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {pendingLabel}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sendCodePending, setSendCodePending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<"account" | "phone">("account");

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  function navigateTo(target: string) {
    if (target.startsWith("/") && !target.startsWith("//") && !target.includes("\\")) {
      router.push(target);
      router.refresh();
      return;
    }
    window.location.assign(target);
  }

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
        body: JSON.stringify({ username, password, returnTo }),
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

      navigateTo(result.redirectTo || "/reports");
    } catch (requestError) {
      console.error("Login request failed", requestError);
      setError("登录服务暂时不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function sendCode() {
    const normalizedPhone = phone.trim();
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      setError("请输入正确的手机号。");
      return;
    }
    setSendCodePending(true);
    setError(null);
    try {
      const response = await fetch("/api/phone-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ phone: normalizedPhone }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        setError(result.message || "验证码发送失败。");
        return;
      }
      setCountdown(60);
      setError(null);
    } catch {
      setError("验证码服务暂时不可用，请稍后重试。");
    } finally {
      setSendCodePending(false);
    }
  }

  async function handlePhoneSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const normalizedPhone = phone.trim();
    const code = typeof formData.get("code") === "string" ? formData.get("code")?.toString().trim() : "";
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      setError("请输入正确的手机号。");
      return;
    }
    if (!code) {
      setError("请输入验证码。");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/phone-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, code, returnTo }),
      });
      const result = await response.json() as { success?: boolean; message?: string; redirectTo?: string };
      if (!response.ok || !result.success) {
        setError(result.message || "验证失败，请稍后重试。");
        return;
      }
      navigateTo(result.redirectTo || "/reports");
    } catch {
      setError("登录服务暂时不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-10">
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
          aria-selected={activeTab === "phone"}
          onClick={() => setActiveTab("phone")}
          className={`pb-[10px] text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2167E8]/30 ${
            activeTab === "phone" ? "font-bold text-[#2167E8]" : "text-[#8997AA]"
          }`}
        >
          手机号登录 / 注册
        </button>
      </div>

      {activeTab === "phone" ? (
        <form onSubmit={handlePhoneSubmit} className="mt-7 space-y-4" role="tabpanel">
          <label className="block">
            <span className="sr-only">手机号</span>
            <input
              type="tel"
              name="phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
              autoComplete="tel"
              className="h-12 w-full rounded-md border border-[#DDE5F0] bg-white px-[15px] text-[14px] text-[#2B3A52] outline-none placeholder:text-[#8A98AC] transition focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10"
              placeholder="请输入手机号"
            />
          </label>

          <label className="block">
            <span className="sr-only">验证码</span>
            <div className="flex h-12 items-center gap-2 rounded-md border border-[#DDE5F0] bg-[#F7F9FC] px-2.5 transition focus-within:border-[#2167E8] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#2167E8]/10">
              <input
                type="text"
                inputMode="numeric"
                name="code"
                autoComplete="one-time-code"
                maxLength={4}
                className="h-full min-w-0 flex-1 border-0 bg-transparent px-1 text-[14px] tracking-[0.18em] text-[#2B3A52] outline-none placeholder:text-[#8A98AC]"
                placeholder="请输入验证码"
              />
              <button type="button" onClick={() => void sendCode()} disabled={sendCodePending || countdown > 0} className="h-8 shrink-0 rounded border border-[#C9D8F6] bg-white px-2.5 text-xs font-semibold text-[#2167E8] transition hover:border-[#2167E8] disabled:cursor-not-allowed disabled:text-[#9AA8BA]">
                {sendCodePending ? "发送中" : countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
              </button>
            </div>
          </label>

          <p className="text-xs leading-5 text-[#8A98AC]">未注册手机号会自动创建个人工作台。测试环境验证码：<strong className="font-semibold text-[#526174]">8888</strong></p>

          {error ? (
            <div className="rounded-md border border-[#FFD4DC] bg-[#FFF6F7] px-3 py-2.5 text-sm text-[#C73A55]" role="alert">
              {error}
            </div>
          ) : null}

          <SubmitButton pending={pending} pendingLabel="验证中" label="登录 / 创建工作台" />
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 space-y-4" role="tabpanel">
          <label className="block">
            <span className="sr-only">登录账号</span>
            <div className="flex h-12 items-center justify-between rounded-md border border-[#DDE5F0] bg-white px-[15px] transition focus-within:border-[#2167E8] focus-within:ring-4 focus-within:ring-[#2167E8]/10">
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

          <SubmitButton pending={pending} pendingLabel="登录中" label="登录" />
        </form>
      )}
    </div>
  );
}
