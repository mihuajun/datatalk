"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, Database, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { DataSourceRecord } from "@/lib/server/data-source-repository";
import {
  CONNECTOR_CATALOG,
  CONNECTOR_CATEGORIES,
  type ConnectorCatalogItem,
} from "@/lib/data-source-catalog";
import {
  createDataSourceForm,
  DataSourceFormDrawer,
  getDefaultPort,
  type DataSourceFormState,
} from "@/components/data-sources/data-source-form-drawer";

function ConnectorLogo({ item }: { item: ConnectorCatalogItem }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white shadow-[0_3px_12px_rgba(23,36,58,0.08)]" style={{ backgroundColor: `${item.color}16` }}>
      {failed ? (
        <span className="text-[13px] font-extrabold tracking-[-0.04em]" style={{ color: item.color }}>{item.monogram}</span>
      ) : (
        <img src={item.iconPath} alt="" aria-hidden="true" className="h-7 w-7 object-contain" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

export function ConnectorPickerClient() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedConnector, setSelectedConnector] = useState<ConnectorCatalogItem | null>(null);
  const [form, setForm] = useState<DataSourceFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return CONNECTOR_CATEGORIES.map((category) => ({
      category,
      items: CONNECTOR_CATALOG.filter((item) => {
        if (item.category !== category) return false;
        if (!normalizedQuery) return true;
        return [item.name, item.description, ...item.aliases].join(" ").toLowerCase().includes(normalizedQuery);
      }),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  const supportedCount = CONNECTOR_CATALOG.length;

  function selectConnector(item: ConnectorCatalogItem) {
    setSelectedConnector(item);
    setForm(createDataSourceForm(item.type));
    setError(null);
    setTestMessage(null);
  }

  function closeDrawer() {
    setForm(null);
    setSelectedConnector(null);
    setError(null);
    setTestMessage(null);
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
    if (!form || !selectedConnector) return;
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
    if (!form || !selectedConnector) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/data-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { dataSource?: DataSourceRecord; message?: string };
      if (!response.ok || !result.dataSource) {
        setError(result.message || "保存失败");
        return;
      }
      router.push("/data-sources");
      router.refresh();
    } catch {
      setError("连接器服务暂时不可用");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-3 text-sm text-[#71819B]">
        <Link href="/data-sources" className="inline-flex items-center gap-1.5 font-semibold text-[#526174] transition hover:text-[#2167E8]">
          <ArrowLeft className="h-4 w-4" />
          连接器
        </Link>
        <span aria-hidden="true" className="text-[#C5CDD8]">/</span>
        <span>新增连接器</span>
      </div>

      <section className="mt-6 flex flex-col gap-6 border-b border-[#DDE5F0] pb-7 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8F1FF] text-[#2167E8]">
              <Database className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-[25px] font-bold leading-tight tracking-[-0.03em] text-[#17243A]">选择连接器类型</h1>
              <p className="mt-1 text-sm text-[#71819B]">选择要接入的数据平台，下一步配置连接参数</p>
            </div>
          </div>
        </div>
        <div className="flex w-full items-center gap-3 xl:w-[390px]">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">搜索连接器类型</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A98AC]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 w-full rounded-md border border-[#DDE5F0] bg-white pl-10 pr-3 text-sm text-[#344054] outline-none transition placeholder:text-[#9AA8BA] focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10" placeholder="搜索名称、类型或关键词" />
          </label>
          <span className="shrink-0 text-xs text-[#8A98AC]">{supportedCount} / {CONNECTOR_CATALOG.length} 已支持</span>
        </div>
      </section>

      <div className="mt-8 space-y-9">
        {groups.map((group) => (
          <section key={group.category} aria-labelledby={`connector-category-${group.category}`}>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 id={`connector-category-${group.category}`} className="text-sm font-bold text-[#17243A]">{group.category}</h2>
                <p className="mt-1 text-xs text-[#8A98AC]">{group.items.length} 个连接器选项</p>
              </div>
              <span className="hidden text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B0BBCB] sm:block">CONNECTOR CATALOG</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {group.items.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => selectConnector(item)}
                  className="group relative flex min-h-[152px] flex-col justify-between overflow-hidden rounded-lg border border-[#DDE5F0] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#9DBFF7] hover:shadow-[0_10px_24px_rgba(33,103,232,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2167E8]/40"
                  aria-label={`选择${item.name}连接器`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <ConnectorLogo item={item} />
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF8F2] px-2 py-1 text-[10px] font-bold text-[#16845B]">
                      <Check className="h-3 w-3" />
                      已支持
                    </span>
                  </div>
                  <div className="mt-4">
                    <h3 className="text-[15px] font-bold text-[#17243A]">{item.name}</h3>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[#71819B]">{item.description}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-[#A2AEBD]">
                    <span>{item.category}</span>
                    <span className="text-[#2167E8] opacity-0 transition group-hover:opacity-100">配置连接器 →</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="mt-8 border border-dashed border-[#C9D5E5] bg-white px-6 py-16 text-center">
          <Search className="mx-auto h-6 w-6 text-[#B0BBCB]" />
          <p className="mt-3 text-sm font-semibold text-[#526174]">没有找到匹配的连接器</p>
          <p className="mt-1 text-xs text-[#8A98AC]">试试搜索 MySQL、缓存或 API</p>
        </div>
      ) : null}

      {form && selectedConnector ? (
        <DataSourceFormDrawer
          form={form}
          editing={Boolean(form.id)}
          saving={saving}
          testing={testing}
          error={error}
          testMessage={testMessage}
          onChange={changeForm}
          onClose={closeDrawer}
          onSubmit={save}
          onTest={testConnection}
        />
      ) : null}
    </div>
  );
}
