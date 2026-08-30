export type ConnectorCategory = "关系型数据库" | "分析型数据库" | "文档、缓存与搜索" | "接口连接器";

export type ConnectorCatalogItem = {
  type: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  aliases: string[];
  slug: string;
  color: string;
  monogram: string;
  iconPath: string;
  supported: boolean;
};

const SUPPORTED_CONNECTOR_TYPES = new Set([
  "MySQL", "PostgreSQL", "MariaDB", "SQL Server", "Oracle", "SQLite", "TiDB", "OceanBase",
  "ClickHouse", "Apache Doris", "StarRocks", "Snowflake", "BigQuery", "Amazon Redshift",
  "Databricks SQL", "DuckDB", "Trino", "Greenplum", "MongoDB", "Redis", "Elasticsearch",
  "REST API", "GraphQL",
]);
const LOCAL_ICON_BY_TYPE: Record<string, string> = {
  MySQL: "/connectors/mysql.svg",
  PostgreSQL: "/connectors/postgresql.svg",
  MariaDB: "/connectors/mariadb.svg",
  "SQL Server": "/connectors/microsoftsqlserver.svg",
  Oracle: "/connectors/oracle.svg",
  SQLite: "/connectors/sqlite.svg",
  TiDB: "/connectors/tidb.svg",
  ClickHouse: "/connectors/clickhouse.svg",
  "Apache Doris": "/connectors/apachedoris.svg",
  Snowflake: "/connectors/snowflake.svg",
  BigQuery: "/connectors/googlebigquery.svg",
  "Amazon Redshift": "/connectors/amazonredshift.svg",
  "Databricks SQL": "/connectors/databricks.svg",
  DuckDB: "/connectors/duckdb.svg",
  Trino: "/connectors/trino.svg",
  MongoDB: "/connectors/mongodb.svg",
  Redis: "/connectors/redis.svg",
  Elasticsearch: "/connectors/elasticsearch.svg",
  "REST API": "/connectors/api.svg",
  GraphQL: "/connectors/graphql.svg",
};

function connector(
  type: string,
  category: ConnectorCategory,
  description: string,
  aliases: string[],
  slug: string,
  color: string,
  monogram: string,
): ConnectorCatalogItem {
  const iconPath = LOCAL_ICON_BY_TYPE[type]
    || (category === "分析型数据库" ? "/connectors/analytics.svg" : "/connectors/database.svg");

  return {
    type,
    name: type,
    category,
    description,
    aliases,
    slug,
    color,
    monogram,
    iconPath,
    supported: SUPPORTED_CONNECTOR_TYPES.has(type),
  };
}

export const CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  connector("MySQL", "关系型数据库", "成熟稳定的业务数据库，适合订单、用户与交易系统。", ["mysql", "关系型", "业务库"], "mysql", "#4479A1", "MY"),
  connector("PostgreSQL", "关系型数据库", "功能完整的开源数据库，适合中台与复杂业务模型。", ["postgres", "关系型", "开源"], "postgresql", "#4169E1", "PG"),
  connector("MariaDB", "关系型数据库", "兼容 MySQL 生态的开源关系型数据库。", ["mysql", "关系型", "开源"], "mariadb", "#003545", "MA"),
  connector("SQL Server", "关系型数据库", "适合企业级应用与微软数据平台的关系型数据库。", ["mssql", "微软", "关系型"], "microsoftsqlserver", "#CC2927", "MS"),
  connector("Oracle", "关系型数据库", "面向大型企业核心系统的商业数据库。", ["oracle database", "企业级", "关系型"], "oracle", "#F80000", "OR"),
  connector("SQLite", "关系型数据库", "零配置嵌入式数据库，适合轻量应用与本地文件。", ["sqlite3", "嵌入式", "文件数据库"], "sqlite", "#003B57", "SQ"),
  connector("TiDB", "关系型数据库", "兼容 MySQL 的分布式数据库，支持水平扩展。", ["mysql", "分布式", "tidb"], "tidb", "#64B5F6", "TI"),
  connector("OceanBase", "关系型数据库", "面向金融与企业场景的分布式关系型数据库。", ["分布式", "国产数据库", "ob"], "oceanbase", "#1B7BEA", "OB"),

  connector("ClickHouse", "分析型数据库", "高性能列式分析数据库，适合明细查询与实时分析。", ["olap", "列式", "实时分析"], "clickhouse", "#FFCC01", "CH"),
  connector("Apache Doris", "分析型数据库", "统一的实时数仓，适合报表、即席分析与湖仓查询。", ["doris", "数仓", "olap"], "apachedoris", "#4C7BF3", "DO"),
  connector("StarRocks", "分析型数据库", "高并发实时数仓，适合多维分析和查询加速。", ["starrocks", "数仓", "olap"], "starrocks", "#4A90E2", "SR"),
  connector("Snowflake", "分析型数据库", "云原生数据平台，适合弹性数仓与跨团队分析。", ["云数仓", "warehouse", "snowflake"], "snowflake", "#29B5E8", "SF"),
  connector("BigQuery", "分析型数据库", "Google Cloud 的无服务器数据仓库。", ["gcp", "云数仓", "google"], "googlebigquery", "#669DF6", "BQ"),
  connector("Amazon Redshift", "分析型数据库", "AWS 云数据仓库，适合大规模分析工作负载。", ["aws", "云数仓", "redshift"], "amazonredshift", "#8C4FFF", "RS"),
  connector("Databricks SQL", "分析型数据库", "面向湖仓架构的 SQL 分析引擎。", ["lakehouse", "spark", "databricks"], "databricks", "#FF3621", "DB"),
  connector("DuckDB", "分析型数据库", "嵌入式分析数据库，适合本地文件和轻量数据处理。", ["olap", "嵌入式", "分析"], "duckdb", "#FFF000", "DK"),
  connector("Trino", "分析型数据库", "面向多数据源联邦查询的分布式 SQL 引擎。", ["presto", "联邦查询", "sql"], "trino", "#DD00A1", "TR"),
  connector("Greenplum", "分析型数据库", "基于 PostgreSQL 的大规模并行数据仓库。", ["gp", "数仓", "postgres"], "greenplum", "#00AEEF", "GP"),

  connector("MongoDB", "文档、缓存与搜索", "灵活的文档数据库，适合半结构化业务数据。", ["nosql", "文档", "mongodb"], "mongodb", "#47A248", "MG"),
  connector("Redis", "文档、缓存与搜索", "高性能键值数据库，适合缓存、队列与实时状态。", ["缓存", "key value", "redis"], "redis", "#DC382D", "RD"),
  connector("Elasticsearch", "文档、缓存与搜索", "分布式搜索与分析引擎，适合日志和全文检索。", ["搜索", "日志", "es"], "elasticsearch", "#005571", "ES"),

  connector("REST API", "接口连接器", "通过只读 HTTP 接口接入广告、CRM 与工单系统。", ["http", "api", "接口"], "swagger", "#85EA2D", "API"),
  connector("GraphQL", "接口连接器", "按需获取结构化业务数据的 API 查询协议。", ["api", "graphql", "接口"], "graphql", "#E10098", "GQL"),
];

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  "关系型数据库",
  "分析型数据库",
  "文档、缓存与搜索",
  "接口连接器",
];
