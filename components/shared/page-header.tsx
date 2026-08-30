import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <section className="panel flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
      <div className="space-y-2">
        <div className="text-xs font-semibold text-[#2167E8]">{eyebrow}</div>
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em] text-[#17243A]">{title}</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-[#71819B]">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </section>
  );
}
