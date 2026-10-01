import { BarChart3, ShieldCheck, UserRound } from "lucide-react";

export function AuthVisual({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register";
  return (
    <div className="relative hidden min-h-[520px] overflow-hidden rounded-lg bg-[#F4F8FD] px-10 py-11 lg:block">
      <div className="relative z-10 max-w-[390px]">
        <p className="text-xs font-semibold tracking-[0.08em] text-[#2167E8]">DATATALK WORKSPACE</p>
        <h2 className="mt-4 text-[32px] font-bold leading-[1.22] tracking-[-0.03em] text-[#17243A]">{register ? "先创建账号，" : "从一个问题开始"}<br /><span className="text-[#2167E8]">把数据变成答案。</span></h2>
        <p className="mt-4 max-w-[350px] text-sm leading-6 text-[#71819B]">{register ? "完成身份验证后，用自然语言创建、分析和分享报表。" : "用自然语言描述需求，连接数据后即可生成可读、可继续修改的报表。"}</p>
      </div>
      <div className="absolute inset-x-0 bottom-0 top-[230px]" aria-hidden="true">
        <img src="/auth/data-journey.png" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute left-[16%] top-[66%] inline-flex -translate-y-1/2 items-center gap-2 rounded-md border border-[#D9E8F8] bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-[#2167E8] shadow-[0_4px_12px_rgba(33,103,232,0.08)]"><UserRound className="h-4 w-4" />{register ? "创建账号" : "提出问题"}</div>
        <div className="absolute left-[46%] top-[39%] inline-flex -translate-y-1/2 items-center gap-2 rounded-md border border-[#D9EEF1] bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-[#168FA2] shadow-[0_4px_12px_rgba(24,185,129,0.07)]"><ShieldCheck className="h-4 w-4" />{register ? "验证身份" : "理解数据"}</div>
        <div className="absolute right-[4%] top-[11%] inline-flex -translate-y-1/2 items-center gap-2 rounded-md border border-[#D9E8F8] bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-[#2167E8] shadow-[0_4px_12px_rgba(33,103,232,0.08)]"><BarChart3 className="h-4 w-4" />开始分析</div>
      </div>
    </div>
  );
}
