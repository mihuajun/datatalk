import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { ExternalReturn } from "@/components/auth/external-return";
import { getAuthSession } from "@/lib/server/auth-session";
import { safeReturnTo } from "@/lib/server/safe-return-to";

function DataTalkLogo() {
  return (
    <div className="flex h-[54px] w-[54px] items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 54 54" className="h-full w-full" fill="none">
        <rect x="1" y="1" width="52" height="52" rx="10" fill="#F7FBFF" stroke="#BBD7FF" />
        <path d="M14 14v26M24 14v26M34 14v26M40 14H14M40 25H14M40 36H14" stroke="#D6E8FF" strokeWidth="1.4" />
        <path d="M12 35.5 22 25l8 5 12-13" stroke="#2167E8" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="35.5" r="4" fill="#52CDE5" stroke="white" strokeWidth="2" />
        <circle cx="22" cy="25" r="4" fill="#2167E8" stroke="white" strokeWidth="2" />
        <circle cx="30" cy="30" r="4" fill="#756CF4" stroke="white" strokeWidth="2" />
        <circle cx="42" cy="17" r="4" fill="#18B981" stroke="white" strokeWidth="2" />
        <path d="m32.5 33.5 8 8.5-5.5-1.4-2.2 5.4-2.3-1 2.2-5.2-4.3-2.2 4.1-4.1Z" fill="#17243A" />
      </svg>
    </div>
  );
}

function ReportPreview() {
  const bars = [56, 88, 70, 112, 96];

  return (
    <div className="report-preview relative w-full max-w-[690px]">
      <div className="mb-8 ml-8">
        <h2 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#17243A]">一句话，生成一份报表</h2>
        <p className="mt-3 text-sm text-[#71819B]">描述需求，AI 直接生成可预览、可继续修改的报表</p>
      </div>

      <div className="relative flex items-start gap-6">
        <div className="mt-6 w-[246px] shrink-0 rounded-lg bg-[#2167E8] p-[18px] shadow-[0_14px_28px_rgba(20,86,212,0.18)]">
          <div className="flex items-center gap-2">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white/20">
              <MessageCircle className="h-3.5 w-3.5 text-white" />
            </span>
            <span className="text-xs font-semibold text-[#DCE9FF]">业务需求</span>
          </div>
          <p className="mt-3 whitespace-pre-line text-[15px] font-semibold leading-[1.55] text-white">
            {"帮我分析最近 30 天各区域\n销售额趋势，并按周展示"}
          </p>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-[#D9E5F3] bg-white/95 shadow-[0_20px_42px_rgba(40,91,151,0.12)]">
          <div className="flex h-[58px] items-center justify-between border-b border-[#E7EDF5] px-[18px]">
            <div>
              <div className="text-base font-bold text-[#17243A]">区域销售趋势分析</div>
              <div className="mt-1 text-[10px] text-[#8290A5]">最近 30 天 · 按周统计</div>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-[#EAF8F2] px-2.5 py-1.5 text-[10px] font-semibold text-[#16845B]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#12B981]" />
              已生成
            </div>
          </div>

          <div className="flex gap-2.5 px-[18px] py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-[#7B889C]">销售额</div>
              <div className="mt-1 whitespace-nowrap text-[20px] font-bold text-[#2167E8]">¥ 8.42M</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-[#7B889C]">订单数</div>
              <div className="mt-1 whitespace-nowrap text-[20px] font-bold text-[#12B981]">126,430</div>
            </div>
          </div>

          <div className="flex h-[170px] items-end gap-3 border-t border-[#F0F3F8] px-5 pb-4 pt-4">
            {bars.map((height, index) => (
              <div key={height} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div
                  className="w-full max-w-[28px] rounded-t"
                  style={{ backgroundColor: index === 3 ? "#2167E8" : "#8CB5F5", height }}
                />
                <span className="text-[9px] text-[#8B97A9]">W{index + 1}</span>
              </div>
            ))}
          </div>

          <div className="flex h-10 items-center gap-2 bg-[#F7FAFE] px-[18px] text-[11px] text-[#5274A6]">
            <MessageCircle className="h-3.5 w-3.5" />
            继续说：把区域改成省份
          </div>
        </div>
      </div>

    </div>
  );
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const session = await getAuthSession();
  const { next } = (await searchParams) || {};

  if (session) {
    const target = safeReturnTo(next);
    if (target.startsWith("/")) redirect(target);
    return <ExternalReturn href={target} />;
  }

  return (
    <main className="login-canvas relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-20 top-8 h-[3px] w-[940px] rotate-[-28deg] rounded-full bg-white/55" />
        <div className="absolute left-[50%] top-[68px] h-[3px] w-[410px] rotate-[-25deg] rounded-full bg-white/70" />
        <div className="absolute left-[71%] top-[120px] h-[3px] w-[620px] rotate-[24deg] rounded-full bg-white/45" />
        <div className="absolute -bottom-12 right-[-120px] h-[3px] w-[620px] rotate-[-18deg] rounded-full bg-white/45" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[1216px] items-center px-5 py-10 sm:px-8 lg:px-0">
        <div className="grid w-full items-center gap-12 lg:grid-cols-[438px_minmax(0,1fr)] lg:gap-[75px]">
          <section className="min-h-0 w-full max-w-[438px] justify-self-center rounded-lg border border-white/80 bg-white/[.96] px-7 py-9 shadow-[0_24px_64px_rgba(38,91,158,0.10),0_-1px_0_rgba(255,255,255,0.8)] sm:px-[50px] sm:py-11 lg:min-h-[540px] lg:justify-self-start">
            <div className="flex items-center gap-4">
              <DataTalkLogo />
              <div className="min-w-0">
                <div className="text-xl font-extrabold tracking-[-0.02em] text-[#17243A]">DataTalk</div>
                <div className="mt-1 text-[11px] font-semibold text-[#71819B]">用对话完成报表开发</div>
              </div>
            </div>

            <div className="mt-10 flex items-center">
              <h1 className="text-[30px] font-bold leading-none tracking-[-0.04em] text-[#17243A]">登录工作台</h1>
            </div>

            <LoginForm returnTo={next} />
          </section>

          <section className="hidden min-w-0 lg:block" aria-label="DataTalk 产品预览">
            <ReportPreview />
          </section>
        </div>
      </div>
    </main>
  );
}
