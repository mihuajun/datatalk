"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Database, Plus, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import type { DataSourceRecord } from "@/lib/server/data-source-repository";
import {
  DATA_SOURCE_OPTIONS,
  DataSourceFormDrawer,
  getDefaultPort,
  type DataSourceFormState,
} from "@/components/data-sources/data-source-form-drawer";

const statusTone: Record<DataSourceRecord["status"], string> = {
  在线: "text-[#16845B] bg-[#EAF8F2]",
  同步中: "text-[#2167E8] bg-[#EDF3FF]",
  告警: "text-[#B86B11] bg-[#FFF6E8]",
};

function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 min-w-[132px] appearance-none rounded-md border border-[#DDE5F0] bg-white py-0 pl-3 pr-9 text-[13px] text-[#526174] outline-none focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10">
        {options.map((option) => <option key={option} value={option}>{label}：{option}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A98AC]" />
    </label>
  );
}

export function DataSourcesClient({ initialDataSources }: { initialDataSources: DataSourceRecord[] }) {
  const router = useRouter();
  const [dataSources, setDataSources] = useState(initialDataSources);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [form, setForm] = useState<DataSourceFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => dataSources.filter((source) =>
      `${source.name} ${source.host} ${source.database} ${source.owner}`.toLowerCase().includes(query.trim().toLowerCase())
      && (type === "全部" || source.type === type)
      && (status === "全部" || source.status === status),
    ),
    [dataSources, query, type, status],
  );

  function openCreate() {
    router.push("/data-sources/new");
  }

  function openEdit(source: DataSourceRecord) {
    setError(null);
    setTestMessage(null);
    setForm({
      id: source.id,
      name: source.name,
      type: source.type,
      host: source.host,
      port: source.port?.toString() || "",
      database: source.database,
      username: source.username,
      password: "",
    });
  }

  function changeForm(key: keyof DataSourceFormState, value: string) {
    setTestMessage(null);
    setForm((previous) => {
      if (!previous) return previous;
      if (key !== "type") return { ...previous, [key]: value };
      return { ...previous, type: value, port: getDefaultPort(value) };
    });
  }

  async function testConnection() {
    if (!form) return;
    setTesting(true);
    setError(null);
    setTestMessage(null);
    try {
      const response = await fetch("/api/data-sources/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { message?: string };
      if (response.ok) setTestMessage(result.message || "连接成功");
      else setError(result.message || "连接失败");
    } catch {
      setError("连接测试服务暂时不可用");
    } finally {
      setTesting(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(form.id ? `/api/data-sources/${form.id}` : "/api/data-sources", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { dataSource?: DataSourceRecord; message?: string };
      if (!response.ok || !result.dataSource) {
        setError(result.message || "保存失败");
        return;
      }
      setDataSources((previous) => form.id
        ? previous.map((item) => item.id === result.dataSource?.id ? result.dataSource! : item)
        : [...previous, result.dataSource!]);
      setForm(null);
    } catch {
      setError("连接器服务暂时不可用");
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/data-sources/refresh", { method: "POST" });
      const result = await response.json() as { dataSources?: DataSourceRecord[] };
      if (response.ok && result.dataSources) setDataSources(result.dataSources);
    } finally {
      setRefreshing(false);
    }
  }

  async function remove(source: DataSourceRecord) {
    if (!window.confirm(`确认删除连接器“${source.name}”？`)) return;
    const response = await fetch(`/api/data-sources/${source.id}`, { method: "DELETE" });
    if (response.ok) setDataSources((previous) => previous.filter((item) => item.id !== source.id));
  }

  async function duplicate(source: DataSourceRecord) {
    const response = await fetch(`/api/data-sources/${source.id}/duplicate`, { method: "POST" });
    const result = await response.json() as { dataSource?: DataSourceRecord; message?: string };
    if (response.ok && result.dataSource) setDataSources((previous) => [...previous, result.dataSource!]);
    else setError(result.message || "复制失败");
  }

  return (
    <div className="min-w-0">
      <section className="flex min-h-[52px] items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.03em] text-[#17243A]">连接器配置</h1>
          <p className="mt-2 text-sm text-[#71819B]">管理租户内的数据连接与同步状态</p>
        </div>
        <div className="hidden items-center gap-2 text-xs text-[#8A98AC] md:flex">
          <Database className="h-4 w-4" />
          {dataSources.length} 个连接器
        </div>
      </section>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block">
            <span className="sr-only">搜索连接器</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A98AC]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-[300px] rounded-md border border-[#DDE5F0] bg-white pl-9 pr-3 text-[13px] outline-none placeholder:text-[#8A98AC] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder="搜索连接器或负责人" />
          </label>
          <SelectFilter label="类型" value={type} onChange={setType} options={["全部", ...DATA_SOURCE_OPTIONS]} />
          <SelectFilter label="状态" value={status} onChange={setStatus} options={["全部", "在线", "同步中", "告警"]} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#DDE5F0] bg-white px-3 text-[13px] font-semibold text-[#526174] transition hover:border-[#2167E8] hover:text-[#2167E8] disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            刷新状态
          </button>
          <button type="button" onClick={openCreate} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2167E8] px-3.5 py-2.5 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(33,103,232,0.20)] transition hover:bg-[#1859D1]">
            <Plus className="h-4 w-4" />
            新增连接器
          </button>
        </div>
      </section>

      <section className="mt-3 overflow-hidden rounded-lg border border-[#DDE5F0] bg-white" aria-label="连接器列表">
        <div className="overflow-x-auto">
          <table className="min-w-[1050px] w-full border-collapse text-left">
            <thead className="bg-[#F5F8FF] text-xs font-semibold text-[#526174]">
              <tr>
                <th className="w-[72px] border-r border-[#E4EAF3] px-4 py-4 text-center">序号</th>
                <th className="w-[220px] border-r border-[#E4EAF3] px-4 py-4">连接器名称</th>
                <th className="w-[130px] border-r border-[#E4EAF3] px-4 py-4">类型</th>
                <th className="w-[260px] border-r border-[#E4EAF3] px-4 py-4">连接地址 / 数据库</th>
                <th className="w-[130px] border-r border-[#E4EAF3] px-4 py-4">负责人</th>
                <th className="w-[180px] border-r border-[#E4EAF3] px-4 py-4">最近同步</th>
                <th className="w-[180px] px-4 py-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((source, index) => (
                <tr key={source.id} className={`h-[58px] border-t border-[#E7EDF5] text-[13px] ${index % 2 === 0 ? "bg-[#FBFCFE]" : "bg-white"}`}>
                  <td className="border-r border-[#EDF2FA] px-4 text-center text-[#8A98AC]">{index + 1}</td>
                  <td className="border-r border-[#EDF2FA] px-4 font-bold text-[#344054]">{source.name}</td>
                  <td className="border-r border-[#EDF2FA] px-4 text-[#526174]">{source.type}</td>
                  <td className="border-r border-[#EDF2FA] px-4">
                    <div className="truncate text-[#526174]">{source.host}{source.port ? `:${source.port}` : ""}</div>
                    <div className="mt-0.5 text-xs text-[#8A98AC]">{source.database || (source.type === "REST API" ? "未指定资源路径" : "未指定数据库")}</div>
                  </td>
                  <td className="border-r border-[#EDF2FA] px-4 text-[#526174]">{source.owner}</td>
                  <td className="border-r border-[#EDF2FA] px-4">
                    <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[source.status]}`}>{source.status}</div>
                    <div className="mt-1 text-xs text-[#8A98AC]">{source.updatedAt}</div>
                  </td>
                  <td className="px-4">
                    <div className="flex items-center gap-3 whitespace-nowrap">
                      <button type="button" onClick={() => openEdit(source)} className="text-[#2167E8] hover:underline">编辑</button>
                      <span aria-hidden="true" className="text-[#C5CDD8]">|</span>
                      <button type="button" onClick={() => duplicate(source)} className="text-[#526174] hover:text-[#2167E8] hover:underline">复制</button>
                      <span aria-hidden="true" className="text-[#C5CDD8]">|</span>
                      <button type="button" onClick={() => remove(source)} className="text-[#C73A55] hover:underline">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? <div className="px-6 py-16 text-center text-sm text-[#8A98AC]">没有匹配的连接器</div> : null}
        </div>
        <div className="flex h-[52px] items-center justify-between border-t border-[#E7EDF5] px-4 text-xs text-[#526174]">
          <span>共 {filtered.length} 条记录，当前显示 1–{filtered.length} 条</span>
          <div className="flex items-center gap-1">
            <button type="button" className="rounded p-1.5 text-[#B8C5D8]" aria-label="上一页" disabled><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className="rounded bg-[#EDF3FF] px-2.5 py-1.5 font-semibold text-[#2167E8]">1</button>
            <button type="button" className="rounded p-1.5 text-[#B8C5D8]" aria-label="下一页" disabled><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </section>

      {form ? (
        <DataSourceFormDrawer
          form={form}
          editing={Boolean(form.id)}
          saving={saving}
          testing={testing}
          error={error}
          testMessage={testMessage}
          onChange={changeForm}
          onClose={() => setForm(null)}
          onSubmit={save}
          onTest={testConnection}
        />
      ) : null}
    </div>
  );
}
