const mysql = require("mysql2/promise");
const { readDatabaseConfig, initializeSqliteDatabase } = require("./lib/config.cjs");

async function main() {
  const baseConfig = readDatabaseConfig();
  if (baseConfig.kind === "sqlite") {
    await initializeSqliteDatabase(baseConfig);
    console.log(`SQLite 连接成功，数据库文件：${baseConfig.path}`);
    return;
  }

  const config = { ...baseConfig, connectTimeout: 10000 };

  console.log("准备连接数据库：");
  console.log(
    JSON.stringify(
      {
        host: config.host,
        port: config.port,
        user: config.user,
        database: config.database ?? null,
      },
      null,
      2,
    ),
  );

  let connection;

  try {
    connection = await mysql.createConnection(config);
    const [rows] = await connection.query("SELECT 1 AS ok");

    console.log("连接成功，测试查询结果：");
    console.log(JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error("连接失败：");
    console.error(
      JSON.stringify(
        {
          code: error.code,
          errno: error.errno,
          sqlState: error.sqlState,
          sqlMessage: error.sqlMessage,
          message: error.message,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main().catch((error) => {
  console.error("脚本执行失败：");
  console.error(error);
  process.exit(1);
});
