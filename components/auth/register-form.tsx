"use client";

import Link from "next/link";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Method = "phone" | "email";

export function RegisterForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("phone");
  const [contact, setContact] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  function switchMethod(next: Method) { setMethod(next); setContact(""); setCountdown(0); setError(null); }

  async function sendCode() {
    const valid = method === "phone" ? /^1\d{10}$/.test(contact) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    if (!valid) return setError(method === "phone" ? "请输入正确的手机号。" : "请输入正确的邮箱地址。");
    setSending(true); setError(null);
    try {
      const response = await fetch(method === "phone" ? "/api/phone-code" : "/api/email-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(method === "phone" ? { phone: contact } : { email: contact }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) return setError(result.message || "验证码发送失败。");
      setCountdown(60);
    } catch { setError("验证码服务暂时不可用，请稍后重试。"); } finally { setSending(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    const confirmPassword = String(data.get("confirmPassword") || "");
    const code = String(data.get("code") || "").trim();
    if (!username || !password || !confirmPassword || !contact || !code) return setError("请完整填写注册信息。");
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, username, password, confirmPassword, contact, code, returnTo }) });
      const result = await response.json() as { success?: boolean; message?: string; redirectTo?: string };
      if (!response.ok || !result.success) return setError(result.message || "注册失败，请稍后重试。");
      const target = result.redirectTo || "/reports";
      if (target.startsWith("/")) { router.push(target); router.refresh(); } else window.location.assign(target);
    } catch { setError("注册服务暂时不可用，请稍后重试。"); } finally { setPending(false); }
  }

  return <div className="mt-7">
    <div className="grid grid-cols-2 rounded-md border border-[#DDE5F0] p-1 text-sm font-semibold" role="tablist" aria-label="注册方式">
      {(["phone", "email"] as Method[]).map((item) => <button key={item} type="button" role="tab" aria-selected={method === item} onClick={() => switchMethod(item)} className={`h-9 rounded ${method === item ? "bg-[#2167E8] text-white" : "text-[#526174] hover:bg-[#F4F7FB]"}`}>{item === "phone" ? "手机号注册" : "邮箱注册"}</button>)}
    </div>
    <form onSubmit={submit} className="mt-5 space-y-3.5">
      <label className="block text-xs font-semibold text-[#344054]">用户名<input name="username" autoComplete="username" className="mt-1.5 h-11 w-full rounded-md border border-[#DDE5F0] px-3 text-sm outline-none placeholder:text-[#9AA8BA] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder="设置你的用户名" /></label>
      <label className="block text-xs font-semibold text-[#344054]">密码<div className="mt-1.5 flex h-11 items-center rounded-md border border-[#DDE5F0] px-3 focus-within:border-[#2167E8] focus-within:ring-4 focus-within:ring-[#2167E8]/10"><input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[#9AA8BA]" placeholder="设置登录密码" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"} className="text-[#8A98AC]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
      <label className="block text-xs font-semibold text-[#344054]">确认密码<div className="mt-1.5 flex h-11 items-center rounded-md border border-[#DDE5F0] px-3 focus-within:border-[#2167E8] focus-within:ring-4 focus-within:ring-[#2167E8]/10"><input name="confirmPassword" type={showConfirm ? "text" : "password"} autoComplete="new-password" className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[#9AA8BA]" placeholder="再次输入密码" /><button type="button" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? "隐藏密码" : "显示密码"} className="text-[#8A98AC]">{showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
      <label className="block text-xs font-semibold text-[#344054]">{method === "phone" ? "手机号" : "邮箱"}<input value={contact} onChange={(event) => setContact(method === "phone" ? event.target.value.replace(/\D/g, "").slice(0, 11) : event.target.value.trim().slice(0, 160))} type={method === "phone" ? "tel" : "email"} autoComplete={method === "phone" ? "tel" : "email"} className="mt-1.5 h-11 w-full rounded-md border border-[#DDE5F0] px-3 text-sm outline-none placeholder:text-[#9AA8BA] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder={method === "phone" ? "输入手机号" : "输入邮箱地址"} /></label>
      <label className="block text-xs font-semibold text-[#344054]">{method === "phone" ? "短信验证码" : "邮箱验证码"}<div className="mt-1.5 flex gap-2"><input name="code" inputMode="numeric" maxLength={6} className="h-11 min-w-0 flex-1 rounded-md border border-[#DDE5F0] px-3 text-sm tracking-[0.15em] outline-none placeholder:text-[#9AA8BA] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder="输入 6 位验证码" /><button type="button" onClick={() => void sendCode()} disabled={sending || countdown > 0} className="h-11 shrink-0 rounded-md border border-[#BFD3F4] px-3 text-xs font-semibold text-[#2167E8] disabled:cursor-not-allowed disabled:text-[#9AA8BA]">{sending ? "发送中" : countdown > 0 ? `${countdown}s` : "获取验证码"}</button></div></label>
      {error ? <div role="alert" className="rounded-md border border-[#FFD4DC] bg-[#FFF6F7] px-3 py-2.5 text-xs text-[#C73A55]">{error}</div> : null}
      <button type="submit" disabled={pending} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#2167E8] text-sm font-bold text-white hover:bg-[#1858CC] disabled:opacity-70">{pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "创建账号"}</button>
    </form>
    <p className="mt-4 text-center text-sm text-[#71819B]">已有账号？ <Link href={`/${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="font-semibold text-[#2167E8] hover:underline">返回登录</Link></p>
    <p className="mt-6 text-center text-[11px] leading-5 text-[#9AA8BA]">注册即表示你同意<Link href="/terms" className="mx-1 text-[#5274A6]">服务条款</Link>和<Link href="/privacy" className="mx-1 text-[#5274A6]">隐私政策</Link></p>
  </div>;
}
