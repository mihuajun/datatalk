"use client";

import { useMemo } from "react";
import { X } from "lucide-react";

import type { DataSourceType } from "@/lib/server/data-source-repository";

export type DataSourceFormState = {
  id?: number;
  name: string;
  type: DataSourceType;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

export const DATA_SOURCE_OPTIONS = [
  "MySQL", "PostgreSQL", "MariaDB", "SQL Server", "Oracle", "SQLite", "TiDB", "OceanBase",
  "ClickHouse", "Apache Doris", "StarRocks", "Snowflake", "BigQuery", "Amazon Redshift",
  "Databricks SQL", "DuckDB", "Trino", "Greenplum", "MongoDB", "Redis", "Elasticsearch",
  "REST API", "GraphQL",
];

export function getDefaultPort(type: string) {
  if (["PostgreSQL", "Greenplum", "Amazon Redshift"].includes(type)) return "5432";
  if (type === "ClickHouse") return "8123";
  if (type === "SQL Server") return "1433";
  if (type === "Oracle") return "1521";
  if (type === "MongoDB") return "27017";
  if (type === "Redis") return "6379";
  if (type === "Elasticsearch") return "9200";
  if (type === "Trino") return "8080";
  if (["REST API", "GraphQL", "SQLite", "DuckDB", "Snowflake", "BigQuery", "Databricks SQL"].includes(type)) return "";
  return "3306";
}

export function createDataSourceForm(type = "MySQL"): DataSourceFormState {
  return { name: "", type, host: "", port: getDefaultPort(type), database: "", username: "", password: "" };
}

type DataSourceFormDrawerProps = {
  form: DataSourceFormState;
  editing: boolean;
  saving: boolean;
  testing: boolean;
  error: string | null;
  testMessage: string | null;
  onChange: (key: keyof DataSourceFormState, value: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onTest: () => void;
};

export function DataSourceFormDrawer({ form, editing, saving, testing, error, testMessage, onChange, onClose, onSubmit, onTest }: DataSourceFormDrawerProps) {
  const isRestApi = form.type === "REST API";
  const isGraphql = form.type === "GraphQL";
  const isLocalFile = form.type === "SQLite" || form.type === "DuckDB";
  const isDocumentStore = form.type === "MongoDB";
  const isCache = form.type === "Redis";
  const isSearch = form.type === "Elasticsearch";
  const isCloudWarehouse = ["Snowflake", "BigQuery", "Databricks SQL"].includes(form.type);
  const typeOptions = useMemo(() => (DATA_SOURCE_OPTIONS.includes(form.type) ? DATA_SOURCE_OPTIONS : [form.type, ...DATA_SOURCE_OPTIONS]), [form.type]);
  const hostLabel = isLocalFile ? "数据库文件路径" : isGraphql ? "GraphQL 基础地址" : isRestApi ? "API 基础地址" : isSearch ? "Elasticsearch 地址" : "连接地址";
  const databaseLabel = isLocalFile ? "数据库（可选）" : isRestApi || isGraphql ? "资源路径" : isDocumentStore ? "数据库" : isCache ? "数据库编号" : form.type === "Databricks SQL" ? "SQL Warehouse HTTP Path 或 ID" : isCloudWarehouse ? "项目 / 数据库" : "数据库";
  const hostPlaceholder = isLocalFile ? "例如：/data/orders.db" : isGraphql || isRestApi ? "https://api.example.com" : isCloudWarehouse ? "账号、Project ID 或 Workspace URL" : "hostname 或 URL";
  const databasePlaceholder = isLocalFile ? "连接器使用文件路径字段" : isRestApi || isGraphql ? "/api/orders" : isDocumentStore ? "例如：analytics" : isCache ? "0" : form.type === "Databricks SQL" ? "/sql/1.0/warehouses/..." : "database";
  const usernamePlaceholder = isRestApi || isGraphql ? "填写后使用 Basic Auth" : isCloudWarehouse ? "账号（按云服务认证配置）" : isCache ? "Redis 用户名（可选）" : "数据库用户名";
  const passwordHint = isRestApi || isGraphql ? "Bearer Token 或 Basic Auth 密码" : form.type === "Databricks SQL" ? "Personal Access Token" : form.type === "BigQuery" ? "使用 ADC 或 GOOGLE_APPLICATION_CREDENTIALS" : isCache ? "Redis 密码（可选）" : "数据库密码";
  const inputClass = "mt-2 h-10 w-full rounded-md border border-[#DDE5F0] px-3 text-sm text-[#344054] outline-none transition focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#17243A]/20 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={editing ? "编辑连接器" : "新增连接器"}>
      <div className="h-full w-full max-w-[460px] overflow-y-auto bg-white p-5 shadow-[-12px_0_36px_rgba(23,36,58,0.12)] sm:p-6">
        <div className="flex items-start justify-between border-b border-[#E7EDF5] pb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#2167E8]">CONNECTOR SETUP</p>
            <h2 className="mt-2 text-lg font-bold text-[#17243A]">{editing ? "编辑连接器" : "新增连接器"}</h2>
            <p className="mt-1 text-xs text-[#8A98AC]">配置当前租户的数据接入连接</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-[#8A98AC] transition hover:bg-[#F5F8FD] hover:text-[#17243A]" aria-label="关闭连接器抽屉" title="关闭"><X className="h-4 w-4" /></button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-[#344054]">连接器名称<input required value={form.name} onChange={(event) => onChange("name", event.target.value)} className={inputClass} placeholder={isRestApi || isGraphql ? "例如：营销投放接口" : "例如：订单中心主库"} /></label>
          <label className="block text-sm font-medium text-[#344054]">连接器类型<select value={form.type} onChange={(event) => onChange("type", event.target.value)} className={`${inputClass} bg-white`}>{typeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label className="block text-sm font-medium text-[#344054]">{hostLabel}<input required value={form.host} onChange={(event) => onChange("host", event.target.value)} className={inputClass} placeholder={hostPlaceholder} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-[#344054]">{isRestApi || isGraphql || isLocalFile || isCloudWarehouse ? "端口（可选）" : "端口"}<input inputMode="numeric" value={form.port} onChange={(event) => onChange("port", event.target.value)} className={inputClass} placeholder={isRestApi || isGraphql || isLocalFile || isCloudWarehouse ? "URL 中已包含时留空" : getDefaultPort(form.type)} /></label>
            <label className="block text-sm font-medium text-[#344054]">{databaseLabel}<input value={form.database} onChange={(event) => onChange("database", event.target.value)} className={inputClass} placeholder={databasePlaceholder} /></label>
          </div>
          <label className="block text-sm font-medium text-[#344054]">{isRestApi || isGraphql || isCache || isCloudWarehouse ? "用户名（可选）" : "用户名"}<input value={form.username} onChange={(event) => onChange("username", event.target.value)} className={inputClass} placeholder={usernamePlaceholder} /></label>
          <label className="block text-sm font-medium text-[#344054]">密码 / Token <span className="text-xs font-normal text-[#8A98AC]">（{editing ? "留空表示不修改" : passwordHint}）</span><input type="password" value={form.password} onChange={(event) => onChange("password", event.target.value)} className={inputClass} placeholder={editing ? "留空表示不修改" : passwordHint} /></label>

          {error ? <div className="rounded-md border border-[#FFD4DC] bg-[#FFF6F7] px-3 py-2.5 text-sm text-[#C73A55]" role="alert">{error}</div> : null}
          {testMessage ? <div className="rounded-md border border-[#CDEFE0] bg-[#F2FCF7] px-3 py-2.5 text-sm text-[#16845B]" role="status">{testMessage}</div> : null}

          <div className="flex gap-3 border-t border-[#E7EDF5] pt-5">
            <button type="button" onClick={onClose} className="h-10 flex-1 rounded-md border border-[#DDE5F0] text-sm font-semibold text-[#526174] transition hover:border-[#B8C5D8] hover:bg-[#F7F9FC]">取消</button>
            <button type="button" onClick={onTest} disabled={testing || saving} className="h-10 flex-1 rounded-md border border-[#2167E8] text-sm font-semibold text-[#2167E8] transition hover:bg-[#EDF3FF] disabled:cursor-not-allowed disabled:opacity-60">{testing ? "测试中" : "测试连接"}</button>
            <button type="submit" disabled={saving || testing} className="h-10 flex-1 rounded-md bg-[#2167E8] text-sm font-semibold text-white shadow-[0_8px_18px_rgba(33,103,232,0.18)] transition hover:bg-[#1859D1] disabled:cursor-not-allowed disabled:opacity-60">{saving ? "保存中" : editing ? "保存修改" : "保存连接器"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
