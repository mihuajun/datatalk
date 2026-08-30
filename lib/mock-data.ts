export type Tenant = {
  id: string;
  dbTenantId: number;
  name: string;
  plan: string;
  domain: string;
  region: string;
  members: number;
  reports: number;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "正常" | "待激活";
  lastActive: string;
};

export type DataSource = {
  id: string;
  name: string;
  type: "MySQL" | "PostgreSQL" | "ClickHouse" | "REST API";
  host: string;
  database: string;
  owner: string;
  status: "在线" | "同步中" | "告警";
  updatedAt: string;
  tenantId: string;
};

export type ReportItem = {
  id: string;
  name: string;
  owner: string;
  updatedAt: string;
  views: number;
};

export type ReportFolder = {
  id: string;
  name: string;
  children?: ReportFolder[];
  reports?: ReportItem[];
};

export const tenants: Tenant[] = [
  {
    id: "tenant-demo",
    dbTenantId: 1,
    name: "演示项目",
    plan: "Starter",
    domain: "demo.insightpilot.ai",
    region: "杭州",
    members: 1,
    reports: 4,
  },
];

export const currentTenant = tenants[0];

export function findTenantByDbTenantId(tenantId: number) {
  return tenants.find((tenant) => tenant.dbTenantId === tenantId);
}

export const members: Member[] = [
  {
    id: "m1",
    name: "王晨",
    email: "wangchen@huadong.ai",
    role: "admin",
    status: "正常",
    lastActive: "今天 10:24",
  },
  {
    id: "m2",
    name: "李琪",
    email: "liqi@huadong.ai",
    role: "developer",
    status: "正常",
    lastActive: "今天 09:11",
  },
  {
    id: "m3",
    name: "周冉",
    email: "zhou.ran@huadong.ai",
    role: "developer",
    status: "待激活",
    lastActive: "未登录",
  },
  {
    id: "m4",
    name: "宋越",
    email: "songyue@huadong.ai",
    role: "admin",
    status: "正常",
    lastActive: "昨天 18:40",
  },
];

export const dataSources: DataSource[] = [
  {
    id: "ds-1",
    name: "订单中心主库",
    type: "MySQL",
    host: "mysql-prod.internal",
    database: "order_center",
    owner: "王晨",
    status: "在线",
    updatedAt: "5 分钟前",
    tenantId: "tenant-huawei",
  },
  {
    id: "ds-2",
    name: "经营分析仓库",
    type: "PostgreSQL",
    host: "pg-warehouse.internal",
    database: "business_analytics",
    owner: "李琪",
    status: "在线",
    updatedAt: "12 分钟前",
    tenantId: "tenant-huawei",
  },
  {
    id: "ds-3",
    name: "实时行为明细",
    type: "ClickHouse",
    host: "ck-stream.internal",
    database: "realtime_events",
    owner: "李琪",
    status: "同步中",
    updatedAt: "正在同步",
    tenantId: "tenant-huawei",
  },
  {
    id: "ds-4",
    name: "营销投放 API",
    type: "REST API",
    host: "https://ads.example.com",
    database: "campaign_open_api",
    owner: "王晨",
    status: "告警",
    updatedAt: "1 小时前",
    tenantId: "tenant-huawei",
  },
];

export const reportFolders: ReportFolder[] = [
  {
    id: "default",
    name: "默认目录",
    children: [
      {
        id: "sales",
        name: "销售分析",
        reports: [
          {
            id: "r-1",
            name: "区域销售驾驶舱",
            owner: "李琪",
            updatedAt: "今天 09:36",
            views: 283,
          },
          {
            id: "r-2",
            name: "渠道转化漏斗",
            owner: "王晨",
            updatedAt: "昨天 20:10",
            views: 141,
          },
        ],
      },
      {
        id: "operations",
        name: "运营监控",
        reports: [
          {
            id: "r-3",
            name: "活动投放看板",
            owner: "周冉",
            updatedAt: "今天 08:58",
            views: 96,
          },
        ],
      },
    ],
    reports: [
      {
        id: "r-0",
        name: "CEO 总览看板",
        owner: "王晨",
        updatedAt: "今天 11:05",
        views: 512,
      },
    ],
  },
  {
    id: "finance",
    name: "财务专题",
    reports: [
      {
        id: "r-4",
        name: "利润结构分析",
        owner: "宋越",
        updatedAt: "昨天 16:22",
        views: 77,
      },
    ],
  },
];

export const reportStats = [
  { label: "租户数", value: "1", hint: "当前为单租户演示项目" },
  { label: "活跃成员", value: "1", hint: "默认账号 guest" },
  { label: "连接器", value: "4", hint: "多类型统一接入" },
  { label: "报表数", value: "4", hint: "目录化沉淀" },
];

export const sourceTypes = [
  {
    name: "MySQL",
    description: "适合业务库、订单库等 OLTP 场景",
  },
  {
    name: "PostgreSQL",
    description: "适合分析库与中台服务数据库",
  },
  {
    name: "ClickHouse",
    description: "适合大体量明细查询和实时分析",
  },
  {
    name: "REST API",
    description: "适合接第三方广告、CRM、工单系统",
  },
];
import type { UserRole } from "@/lib/auth/roles";
