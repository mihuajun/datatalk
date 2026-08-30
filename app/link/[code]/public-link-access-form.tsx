"use client";

import { LockKeyhole, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function PublicLinkAccessForm({ shortCode }: { shortCode: string }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{4}$/.test(password) || submitting) {
      setError("请输入 4 位数字密码");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/public-links/${encodeURIComponent(shortCode)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "密码验证失败");
      window.location.reload();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "密码验证失败");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F7FB] px-5 text-[#17243A]">
      <section className="w-full max-w-[380px] rounded-lg border border-[#DDE5F0] bg-white px-6 py-7 shadow-[0_12px_30px_rgba(23,36,58,0.08)]">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#EDF3FF] text-[#2167E8]"><LockKeyhole className="h-5 w-5" /></div>
        <h1 className="mt-5 text-lg font-bold">请输入访问密码</h1>
        <p className="mt-2 text-xs leading-5 text-[#8A98AC]">该公共报表受密码保护，请输入 4 位数字密码后继续。</p>
        <form className="mt-6" onSubmit={submit}>
          <label htmlFor="public-link-password" className="text-xs font-semibold text-[#526174]">访问密码</label>
          <input
            id="public-link-password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            value={password}
            onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 4))}
            className="mt-2 h-11 w-full rounded-md border border-[#DDE5F0] px-3 text-center text-lg tracking-[0.35em] text-[#17243A] outline-none transition focus:border-[#2167E8] focus:ring-2 focus:ring-[#2167E8]/10"
            placeholder="0000"
            aria-describedby={error ? "public-link-password-error" : undefined}
          />
          {error ? <p id="public-link-password-error" className="mt-2 text-xs text-[#B42318]">{error}</p> : null}
          <button type="submit" disabled={submitting} className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#2167E8] px-4 text-sm font-semibold text-white transition hover:bg-[#1858CC] disabled:cursor-wait disabled:opacity-60">
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            进入报表
          </button>
        </form>
      </section>
    </main>
  );
}
