"use client";

import Link from "next/link";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

type Method = "phone" | "email";

export function ResetPasswordForm({ returnTo }: { returnTo?: string }) {
  const [method, setMethod] = useState<Method>("phone");
  const [contact, setContact] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function sendCode() {
    const valid = method === "phone" ? /^1\d{10}$/.test(contact) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    if (!valid) return setError(method === "phone" ? "请输入正确的手机号。" : "请输入正确的邮箱地址。");
    setSending(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(method === "phone" ? "/api/phone-code" : "/api/email-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(method === "phone" ? { phone: contact, purpose: "reset-password" } : { email: contact, purpose: "reset-password" }) });
      const result = await response.json() as { success?: boolean; message?: string; retryAfter?: number };
      if (!response.ok || !result.success) return setError(result.message || "验证码发送失败。");
      setCountdown(result.retryAfter ? Math.min(result.retryAfter, 60) : 60);
      setSuccess(result.message || (method === "phone" ? "如果手机号已绑定账号，验证码将发送到你的手机。" : "如果邮箱已绑定账号，验证码将发送到你的邮箱。"));
    } catch { setError("验证码服务暂时不可用，请稍后重试。"); } finally { setSending(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code") || "").trim();
    const password = String(data.get("password") || "");
    const confirmPassword = String(data.get("confirmPassword") || "");
    if (!contact || !code || !password || !confirmPassword) return setError("请完整填写重置密码信息。");
    setPending(true); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, contact, code, password, confirmPassword }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) return setError(result.message || "密码重置失败，请稍后重试。");
      setSuccess(result.message || "密码已重置。");
      window.setTimeout(() => { window.location.assign(`/${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`); }, 800);
    } catch { setError("密码重置服务暂时不可用，请稍后重试。"); } finally { setPending(false); }
  }

  return <div className="mt-7">
    <p className="text-sm leading-6 text-[#71819B]">输入注册时绑定的手机号或邮箱，我们会发送验证码帮助你重置登录密码。</p>
    <div className="mt-4 grid grid-cols-2 rounded-md border border-[#DDE5F0] p-1 text-sm font-semibold" role="tablist" aria-label="找回方式">
      {(["phone", "email"] as Method[]).map((item) => <button key={item} type="button" role="tab" aria-selected={method === item} onClick={() => { setMethod(item); setContact(""); setCountdown(0); setError(null); setSuccess(null); }} className={`h-9 rounded ${method === item ? "bg-[#2167E8] text-white" : "text-[#526174] hover:bg-[#F4F7FB]"}`}>{item === "phone" ? "手机号找回" : "邮箱找回"}</button>)}
    </div>
    <form onSubmit={submit} className="mt-5 space-y-3.5">
      <label className="block text-xs font-semibold text-[#344054]">{method === "phone" ? "手机号" : "邮箱地址"}<input value={contact} onChange={(event) => setContact(method === "phone" ? event.target.value.replace(/\D/g, "").slice(0, 11) : event.target.value.trim().slice(0, 160))} type={method === "phone" ? "tel" : "email"} autoComplete={method === "phone" ? "tel" : "email"} className="mt-1.5 h-11 w-full rounded-md border border-[#DDE5F0] px-3 text-sm outline-none placeholder:text-[#9AA8BA] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder={method === "phone" ? "输入注册手机号" : "输入注册邮箱"} /></label>
      <label className="block text-xs font-semibold text-[#344054]">{method === "phone" ? "短信验证码" : "邮箱验证码"}<div className="mt-1.5 flex gap-2"><input name="code" inputMode="numeric" maxLength={6} className="h-11 min-w-0 flex-1 rounded-md border border-[#DDE5F0] px-3 text-sm tracking-[0.15em] outline-none placeholder:text-[#9AA8BA] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder="输入 6 位验证码" /><button type="button" onClick={() => void sendCode()} disabled={sending || countdown > 0} className="h-11 shrink-0 rounded-md border border-[#BFD3F4] px-3 text-xs font-semibold text-[#2167E8] disabled:cursor-not-allowed disabled:text-[#9AA8BA]">{sending ? "发送中" : countdown > 0 ? `${countdown}s` : "获取验证码"}</button></div></label>
      <label className="block text-xs font-semibold text-[#344054]">新密码<div className="mt-1.5 flex h-11 items-center rounded-md border border-[#DDE5F0] px-3 focus-within:border-[#2167E8] focus-within:ring-4 focus-within:ring-[#2167E8]/10"><input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[#9AA8BA]" placeholder="设置 6-72 位新密码" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"} className="text-[#8A98AC]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
      <label className="block text-xs font-semibold text-[#344054]">确认新密码<div className="mt-1.5 flex h-11 items-center rounded-md border border-[#DDE5F0] px-3 focus-within:border-[#2167E8] focus-within:ring-4 focus-within:ring-[#2167E8]/10"><input name="confirmPassword" type={showConfirm ? "text" : "password"} autoComplete="new-password" className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[#9AA8BA]" placeholder="再次输入新密码" /><button type="button" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? "隐藏密码" : "显示密码"} className="text-[#8A98AC]">{showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
      {error ? <div role="alert" className="rounded-md border border-[#FFD4DC] bg-[#FFF6F7] px-3 py-2.5 text-xs text-[#C73A55]">{error}</div> : null}
      {success ? <div role="status" className="rounded-md border border-[#BCEBD8] bg-[#F2FCF7] px-3 py-2.5 text-xs text-[#16845B]">{success}</div> : null}
      <button type="submit" disabled={pending} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#2167E8] text-sm font-bold text-white hover:bg-[#1858CC] disabled:opacity-70">{pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "重置密码"}</button>
    </form>
    <p className="mt-4 text-center text-sm text-[#71819B]"><Link href={`/${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="font-semibold text-[#2167E8] hover:underline">返回登录</Link></p>
  </div>;
}
