import { BrandMark } from "@/components/shared/brand-mark";

export function AuthBrand() {
  return <div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#F5F7FC]" aria-hidden="true"><BrandMark size={36} className="h-9 w-9" /></div><div><div className="text-lg font-extrabold tracking-[-0.02em] text-[#17243A]">DataTalk Studio</div><div className="mt-0.5 text-[10px] font-semibold text-[#71819B]">AI 原生的数据分析与报表开发工作台</div></div></div>;
}
