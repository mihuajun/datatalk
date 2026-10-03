"use client";

import Link from "next/link";
import { Eye, EyeOff, Github, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function SubmitButton({ pending }: { pending: boolean }) {
  return <button type="submit" disabled={pending} className="inline-flex h-12 w-full items-center justify-center rounded-md bg-[#2167E8] text-sm font-bold text-white transition hover:bg-[#1858CC] disabled:cursor-not-allowed disabled:opacity-70">{pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "登录"}</button>;
}

function GoogleMark() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.27c0-.79-.07-1.55-.23-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.42Z" /><path fill="#34A853" d="M12 21.7c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.7Z" /><path fill="#FBBC05" d="M6.54 13.78A5.85 5.85 0 0 1 6.23 12c0-.62.11-1.22.31-1.78V7.69H3.3A9.74 9.74 0 0 0 2.25 12c0 1.56.37 3.03 1.05 4.31l3.24-2.53Z" /><path fill="#EA4335" d="M12 6.19c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.29 14.63 2.3 12 2.3a9.74 9.74 0 0 0-8.7 5.39l3.24 2.53C7.31 7.91 9.46 6.19 12 6.19Z" /></svg>;
}

export function LoginForm({ returnTo, registrationEnabled = true, githubEnabled, googleEnabled }: { returnTo?: string; registrationEnabled?: boolean; githubEnabled?: boolean; googleEnabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [lastLoginMethod, setLastLoginMethod] = useState<string | null>(null);

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)datatalk-last-login-method=([^;]+)/);
    setLastLoginMethod(match?.[1] || null);

    const shouldRestorePassword = window.localStorage.getItem("datatalk-remember-password") === "1";
    setRememberPassword(shouldRestorePassword);
    if (!shouldRestorePassword || !navigator.credentials?.get) return;

    void navigator.credentials.get({ password: true, mediation: "optional" } as CredentialRequestOptions).then((credential) => {
      if (!credential || credential.type !== "password") return;
      const saved = credential as Credential & { id?: string; password?: string };
      if (saved.id) setUsername(saved.id);
      if (saved.password) setPassword(saved.password);
    }).catch(() => {
      // The browser may deny silent credential access; native autofill remains available.
    });
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const loginUsername = String(data.get("username") || "").trim();
    const loginPassword = String(data.get("password") || "");
    if (!loginUsername || !loginPassword) return setError("请输入账号和密码。");
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: loginUsername, password: loginPassword, returnTo }) });
      const result = await response.json() as { success?: boolean; message?: string; redirectTo?: string };
      if (!response.ok || !result.success) return setError(result.message || "登录失败，请稍后重试。");
      if (rememberPassword && typeof window !== "undefined" && "PasswordCredential" in window && navigator.credentials?.store) {
        try {
          const PasswordCredentialConstructor = (window as Window & { PasswordCredential?: new (options: { id: string; password: string; name?: string }) => Credential }).PasswordCredential;
          if (PasswordCredentialConstructor) {
            await navigator.credentials.store(new PasswordCredentialConstructor({ id: loginUsername, password: loginPassword, name: loginUsername }));
          }
        } catch {
          // Browser password managers may reject programmatic storage; login should still succeed.
        }
      }
      if (rememberPassword) window.localStorage.setItem("datatalk-remember-password", "1");
      else window.localStorage.removeItem("datatalk-remember-password");
      document.cookie = "datatalk-last-login-method=password; Path=/; Max-Age=31536000; SameSite=Lax";
      const target = result.redirectTo || "/reports";
      if (target.startsWith("/")) { router.push(target); router.refresh(); } else window.location.assign(target);
    } catch { setError("登录服务暂时不可用，请稍后重试。"); } finally { setPending(false); }
  }

  return <div className="mt-8">
    {registrationEnabled ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="relative min-w-0">
        {githubEnabled ? <Link href={`/api/auth/github${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-md border border-[#DDE5F0] text-xs font-semibold text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#17243A] text-white"><Github className="h-3.5 w-3.5" fill="currentColor" /></span><span>GitHub</span></Link> : <button type="button" disabled title="OAuth 尚未配置" className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-md border border-[#DDE5F0] text-xs font-semibold text-[#526174]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#17243A] text-white opacity-80"><Github className="h-3.5 w-3.5" fill="currentColor" /></span>GitHub</button>}
        {lastLoginMethod === "github" ? <span className="absolute -right-1 -top-2 z-10 rounded-full bg-[#EAF8F2] px-2 py-1 text-[9px] font-semibold text-[#16845B] shadow-[0_2px_6px_rgba(24,132,91,0.10)]">上次登录</span> : null}
      </div>
      <div className="relative min-w-0">
        {googleEnabled ? <Link href={`/api/auth/google${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-md border border-[#DDE5F0] text-xs font-semibold text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF]"><GoogleMark /></span><span>Google</span></Link> : <button type="button" disabled title="Google 登录尚未配置" className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-md border border-[#DDE5F0] text-xs font-semibold text-[#526174]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] opacity-80"><GoogleMark /></span>Google</button>}
        {lastLoginMethod === "google" ? <span className="absolute -right-1 -top-2 z-10 rounded-full bg-[#EAF8F2] px-2 py-1 text-[9px] font-semibold text-[#16845B] shadow-[0_2px_6px_rgba(24,132,91,0.10)]">上次登录</span> : null}
      </div>
    </div> : null}
    <div className="mt-6">
    <form onSubmit={submit} className="space-y-4">
      <div>
        {lastLoginMethod === "password" ? <div className="mb-2 flex justify-end"><span className="rounded-full bg-[#EAF8F2] px-1.5 py-0.5 text-[9px] font-semibold text-[#16845B]">上次登录</span></div> : null}
        <label className="sr-only" htmlFor="login-username">账号</label>
        <input id="login-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="h-12 w-full rounded-md border border-[#DDE5F0] bg-white px-3 text-sm text-[#2B3A52] outline-none placeholder:text-[#9AA8BA] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder="请输入手机号或邮箱" />
      </div>
      <div>
        <label className="sr-only" htmlFor="login-password">密码</label>
        <div className="flex h-12 items-center rounded-md border border-[#DDE5F0] px-3 focus-within:border-[#2167E8] focus-within:ring-4 focus-within:ring-[#2167E8]/10"><input id="login-password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-[#2B3A52] outline-none placeholder:text-[#9AA8BA]" placeholder="请输入密码" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"} className="text-[#8A98AC] hover:text-[#2167E8]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-[#71819B]">
          <input type="checkbox" checked={rememberPassword} onChange={(event) => { const checked = event.target.checked; setRememberPassword(checked); if (checked) window.localStorage.setItem("datatalk-remember-password", "1"); else window.localStorage.removeItem("datatalk-remember-password"); }} className="h-3.5 w-3.5 rounded border-[#C9D4E3] text-[#2167E8] focus:ring-[#2167E8]" />
          记住密码
        </label>
        {registrationEnabled ? <Link href={`/reset-password${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="text-xs text-[#2167E8] hover:underline">忘记密码</Link> : null}
      </div>
      {error ? <div role="alert" className="rounded-md border border-[#FFD4DC] bg-[#FFF6F7] px-3 py-2.5 text-xs text-[#C73A55]">{error}</div> : null}
      <SubmitButton pending={pending} />
    </form>
    </div>
    {registrationEnabled ? <p className="mt-4 text-center text-sm text-[#71819B]">还没有账号？ <Link href={`/register${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="font-semibold text-[#2167E8] hover:underline">立即注册</Link></p> : null}
    <p className="mt-5 text-center text-[11px] leading-5 text-[#9AA8BA]">继续使用即表示同意<Link href="/terms" className="mx-1 text-[#5274A6]">服务条款</Link>与<Link href="/privacy" className="mx-1 text-[#5274A6]">隐私政策</Link></p>
  </div>;
}
