"use client";

import Link from "next/link";
import { Eye, EyeOff, Github, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearRememberedLogin, readRememberedLogin, saveRememberedLogin } from "@/lib/remembered-login";

const providerButtonClassName = "inline-flex h-[60px] w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-[#DDE5F0] bg-white px-1.5 text-[11px] font-semibold leading-4 text-[#526174] transition-colors sm:text-xs";
const providerLinkClassName = `${providerButtonClassName} hover:border-[#B5CFF7] hover:bg-[#F5F9FF] hover:text-[#2167E8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2167E8]/15`;

function SubmitButton({ pending }: { pending: boolean }) {
  return <button type="submit" disabled={pending} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#2167E8] text-sm font-bold text-white transition hover:bg-[#1858CC] disabled:cursor-not-allowed disabled:opacity-70">{pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "登录"}</button>;
}

function GoogleMark() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.27c0-.79-.07-1.55-.23-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.42Z" /><path fill="#34A853" d="M12 21.7c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.7Z" /><path fill="#FBBC05" d="M6.54 13.78A5.85 5.85 0 0 1 6.23 12c0-.62.11-1.22.31-1.78V7.69H3.3A9.74 9.74 0 0 0 2.25 12c0 1.56.37 3.03 1.05 4.31l3.24-2.53Z" /><path fill="#EA4335" d="M12 6.19c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.29 14.63 2.3 12 2.3a9.74 9.74 0 0 0-8.7 5.39l3.24 2.53C7.31 7.91 9.46 6.19 12 6.19Z" /></svg>;
}

export function LoginForm({ returnTo, registrationEnabled = true, githubEnabled, googleEnabled, workbuddyEnabled, loginError }: { returnTo?: string; registrationEnabled?: boolean; githubEnabled?: boolean; googleEnabled?: boolean; workbuddyEnabled?: boolean; loginError?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const interacted = useRef(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [continueTo, setContinueTo] = useState<string | null>(null);
  const [lastLoginMethod, setLastLoginMethod] = useState<string | null>(null);

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)datatalk-last-login-method=([^;]+)/);
    setLastLoginMethod(match?.[1] || null);

    let active = true;
    void readRememberedLogin().then((saved) => {
      // Do not overwrite typing, browser autofill, opt-out, or an unmounted form.
      if (!active || interacted.current || !saved) return;
      setRememberPassword(true);
      setUsername(saved.username);
      setPassword(saved.password);
    }).catch(() => {
      if (active) setStorageNotice("当前浏览器无法读取本地记住密码记录，请手动输入账号密码。");
    });
    return () => { active = false; };
  }, []);

  function navigate(target: string) {
    if (target.startsWith("/")) { router.push(target); router.refresh(); }
    else window.location.assign(target);
  }

  function changeRememberPassword(checked: boolean) {
    interacted.current = true;
    setRememberPassword(checked);
    setStorageNotice(null);
    if (!checked) {
      void clearRememberedLogin().catch(() => {
        setStorageNotice("无法删除本地记住密码记录，请在浏览器设置中清除此网站的数据。");
      });
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    interacted.current = true;
    const data = new FormData(event.currentTarget);
    const loginUsername = String(data.get("username") || "").trim();
    const loginPassword = String(data.get("password") || "");
    if (!loginUsername || !loginPassword) return setError("请输入账号和密码。");
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: loginUsername, password: loginPassword, returnTo }) });
      const result = await response.json() as { success?: boolean; message?: string; redirectTo?: string };
      if (!response.ok || !result.success) return setError(result.message || "登录失败，请稍后重试。");
      document.cookie = "datatalk-last-login-method=password; Path=/; Max-Age=31536000; SameSite=Lax";
      const target = result.redirectTo || "/reports";
      try {
        if (rememberPassword) await saveRememberedLogin({ username: loginUsername, password: loginPassword });
        else await clearRememberedLogin();
      } catch {
        // Authentication succeeded: storage failure must not be reported as a
        // login failure, nor silently promise that credentials were remembered.
        setStorageNotice(rememberPassword
          ? "登录已成功，但浏览器未能保存账号密码（需 HTTPS 且允许网站存储）。本次可继续进入，下次需手动输入。"
          : "登录已成功，但未能删除本地记住密码记录。请在浏览器设置中清除此网站的数据。");
        setContinueTo(target);
        return;
      }
      navigate(target);
    } catch { setError("登录服务暂时不可用，请稍后重试。"); } finally { setPending(false); }
  }

  return <div className="mt-5">
    {loginError && <p role="alert" className="mb-4 rounded-md border border-[#FFD4DC] bg-[#FFF6F7] px-3 py-2.5 text-xs leading-5 text-[#C73A55]">{loginError}</p>}
    {registrationEnabled ? <div className={`grid gap-2 sm:gap-3 ${workbuddyEnabled ? "grid-cols-3" : "grid-cols-2"}`}>
      {workbuddyEnabled && <div className="relative min-w-0">
        <a href={`/api/auth/workbuddy${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className={providerLinkClassName}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center"><img src="/brands/workbuddy.svg" alt="" aria-hidden="true" width={24} height={24} className="h-6 w-6" /></span><span>WorkBuddy</span>
        </a>
        {lastLoginMethod === "workbuddy" && <span className="absolute -right-1 -top-2 z-10 rounded-full bg-[#EAF8F2] px-2 py-1 text-[9px] font-semibold text-[#16845B] shadow-[0_2px_6px_rgba(24,132,91,0.10)]">上次登录</span>}
      </div>}
      <div className="relative min-w-0">
        {githubEnabled ? <Link href={`/api/auth/github${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className={providerLinkClassName}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#17243A] text-white"><Github className="h-3.5 w-3.5" fill="currentColor" /></span><span>GitHub</span></Link> : <button type="button" disabled title="OAuth 尚未配置" className={providerButtonClassName}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#17243A] text-white opacity-80"><Github className="h-3.5 w-3.5" fill="currentColor" /></span>GitHub</button>}
        {lastLoginMethod === "github" ? <span className="absolute -right-1 -top-2 z-10 rounded-full bg-[#EAF8F2] px-2 py-1 text-[9px] font-semibold text-[#16845B] shadow-[0_2px_6px_rgba(24,132,91,0.10)]">上次登录</span> : null}
      </div>
      <div className="relative min-w-0">
        {googleEnabled ? <Link href={`/api/auth/google${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className={providerLinkClassName}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF]"><GoogleMark /></span><span>Google</span></Link> : <button type="button" disabled title="Google 登录尚未配置" className={providerButtonClassName}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] opacity-80"><GoogleMark /></span>Google</button>}
        {lastLoginMethod === "google" ? <span className="absolute -right-1 -top-2 z-10 rounded-full bg-[#EAF8F2] px-2 py-1 text-[9px] font-semibold text-[#16845B] shadow-[0_2px_6px_rgba(24,132,91,0.10)]">上次登录</span> : null}
      </div>
    </div> : null}
    <div className="mt-4">
    <form onSubmit={submit} onFocusCapture={() => { interacted.current = true; }} onChangeCapture={() => { interacted.current = true; }} className="space-y-3">
      <div>
        {lastLoginMethod === "password" ? <div className="mb-2 flex justify-end"><span className="rounded-full bg-[#EAF8F2] px-1.5 py-0.5 text-[9px] font-semibold text-[#16845B]">上次登录</span></div> : null}
        <label className="sr-only" htmlFor="login-username">账号</label>
        <input id="login-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="h-11 w-full rounded-md border border-[#DDE5F0] bg-white px-3 text-sm text-[#2B3A52] outline-none placeholder:text-[#9AA8BA] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder="请输入手机号或邮箱" />
      </div>
      <div>
        <label className="sr-only" htmlFor="login-password">密码</label>
        <div className="flex h-11 items-center rounded-md border border-[#DDE5F0] px-3 focus-within:border-[#2167E8] focus-within:ring-4 focus-within:ring-[#2167E8]/10"><input id="login-password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-[#2B3A52] outline-none placeholder:text-[#9AA8BA]" placeholder="请输入密码" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"} className="text-[#8A98AC] hover:text-[#2167E8]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-[#71819B]">
          <input type="checkbox" checked={rememberPassword} disabled={pending || continueTo !== null} onChange={(event) => changeRememberPassword(event.target.checked)} className="h-3.5 w-3.5 rounded border-[#C9D4E3] text-[#2167E8] focus:ring-[#2167E8]" />
          记住密码
        </label>
        {registrationEnabled ? <Link href={`/reset-password${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="text-xs text-[#2167E8] hover:underline">忘记密码</Link> : null}
      </div>
      <p className="text-[11px] leading-5 text-[#9AA8BA]">仅在私人设备上勾选，登录成功后在此浏览器记住账号密码 30 天；取消勾选可清除。</p>
      {storageNotice && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">{storageNotice}</p>}
      {error ? <div role="alert" className="rounded-md border border-[#FFD4DC] bg-[#FFF6F7] px-3 py-2.5 text-xs text-[#C73A55]">{error}</div> : null}
      {continueTo ? <button type="button" onClick={() => navigate(continueTo)} className="h-11 w-full rounded-md bg-[#2167E8] text-sm font-bold text-white">继续进入</button> : <SubmitButton pending={pending} />}
    </form>
    </div>
    {registrationEnabled ? <p className="mt-3 text-center text-sm text-[#71819B]">还没有账号？ <Link href={`/register${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="font-semibold text-[#2167E8] hover:underline">立即注册</Link></p> : null}
    <p className="mt-3 text-center text-[11px] leading-5 text-[#9AA8BA]">继续使用即表示同意<Link href="/terms" className="mx-1 text-[#5274A6]">服务条款</Link>与<Link href="/privacy" className="mx-1 text-[#5274A6]">隐私政策</Link></p>
  </div>;
}
