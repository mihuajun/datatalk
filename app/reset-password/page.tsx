import { redirect } from "next/navigation";

import { AuthBrand } from "@/components/auth/auth-brand";
import { AuthVisual } from "@/components/auth/auth-visual";
import { ExternalReturn } from "@/components/auth/external-return";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getAuthSession } from "@/lib/server/auth-session";
import { safeReturnTo } from "@/lib/server/safe-return-to";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

export default async function ResetPasswordPage({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const session = await getAuthSession();
  const { next } = (await searchParams) || {};
  if (!isRegistrationEnabled()) redirect(`/${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  if (session) {
    const target = safeReturnTo(next);
    if (target.startsWith("/")) redirect(target);
    return <ExternalReturn href={target} />;
  }

  return <main className="login-canvas relative min-h-screen overflow-x-hidden"><div className="relative mx-auto flex min-h-screen max-w-[1216px] items-center px-5 py-8 sm:px-8 lg:px-0"><div className="grid w-full items-center gap-10 lg:grid-cols-[438px_minmax(0,1fr)] lg:gap-[75px]"><section className="w-full max-w-[438px] justify-self-center rounded-lg border border-white/80 bg-white/[.96] px-7 py-8 shadow-[0_24px_64px_rgba(38,91,158,0.10)] sm:px-[50px] sm:py-9 lg:justify-self-start"><AuthBrand /><h1 className="mt-8 text-[30px] font-bold leading-none tracking-[-0.04em] text-[#17243A]">找回密码</h1><ResetPasswordForm returnTo={next} /></section><AuthVisual mode="login" /></div></div></main>;
}
