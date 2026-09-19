const mysql = require("mysql2/promise");
const { readDatabaseConfig, initializeSqliteDatabase } = require("./lib/config.cjs");

function getConfig() {
  return readDatabaseConfig();
}

function hashPassword(password, salt) {
  return require("node:crypto").createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

const defaultUsers = [
  { name: "管理员", username: "admin", email: "admin@datatalk.local", role: "admin", password: "admin" },
  { name: "开发者", username: "dev", email: "dev@datatalk.local", role: "developer", password: "dev" },
];

async function addColumnIfMissing(connection, column, definition) {
  const [rows] = await connection.query("SHOW COLUMNS FROM tenant_user LIKE ?", [column]);
  if (rows.length === 0) {
    await connection.query(`ALTER TABLE tenant_user ADD COLUMN ${column} ${definition}`);
    console.log(`Added tenant_user.${column}`);
  }
}

async function main() {
  const databaseConfig = getConfig();
  if (databaseConfig.kind === "sqlite") {
    await initializeSqliteDatabase(databaseConfig);
    console.log(`SQLite members initialized at ${databaseConfig.path}; default accounts: admin / admin, dev / dev`);
    return;
  }

  const connection = await mysql.createConnection(databaseConfig);
  try {
    await addColumnIfMissing(connection, "email", "varchar(160) NULL AFTER username");
    await addColumnIfMissing(connection, "phone", "varchar(20) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER username");
    await addColumnIfMissing(connection, "role", "varchar(20) NOT NULL DEFAULT 'developer' AFTER email");
    await addColumnIfMissing(connection, "last_active", "timestamp NULL AFTER status");
    const [phoneIndexRows] = await connection.query("SHOW INDEX FROM tenant_user WHERE Key_name = ?", ["uq_tenant_user_phone"]);
    if (phoneIndexRows.length === 0) await connection.query("ALTER TABLE tenant_user ADD UNIQUE KEY uq_tenant_user_phone (phone)");
    await connection.query(`UPDATE tenant_user
      SET role = CASE
        WHEN LOWER(TRIM(role)) IN ('administrator', 'adminstrator', 'super_admin', 'superadmin') OR role = '超级管理员' THEN 'administrator'
        WHEN role IN ('管理员', '租户管理员') THEN 'admin'
        WHEN role = '开发者' THEN 'developer'
        ELSE role
      END
      WHERE LOWER(TRIM(role)) IN ('administrator', 'adminstrator', 'super_admin', 'superadmin')
         OR role IN ('超级管理员', '管理员', '租户管理员', '开发者')`);

    await connection.query(
      "UPDATE tenant_user SET email = CONCAT(username, '@datatalk.local') WHERE email IS NULL OR email = ''",
    );
    const [guestRows] = await connection.query("SELECT id FROM tenant_user WHERE tenant_id = ? AND username = ? LIMIT 1", [1, "guest"]);
    const [adminRows] = await connection.query("SELECT id FROM tenant_user WHERE tenant_id = ? AND username = ? LIMIT 1", [1, "admin"]);
    if (adminRows.length === 0 && guestRows.length > 0) {
      const salt = require("node:crypto").randomBytes(16).toString("hex");
      await connection.query(
        "UPDATE tenant_user SET name = ?, username = ?, email = ?, role = ?, password = ?, salt = ?, status = 1 WHERE id = ?",
        ["管理员", "admin", "admin@datatalk.local", "admin", hashPassword("admin", salt), salt, guestRows[0].id],
      );
    } else if (adminRows.length > 0 && guestRows.length > 0) {
      await connection.query("UPDATE tenant_user SET status = 0 WHERE id = ?", [guestRows[0].id]);
    }

    for (const user of defaultUsers) {
      const [existing] = await connection.query("SELECT id FROM tenant_user WHERE tenant_id = ? AND username = ? LIMIT 1", [1, user.username]);
      if (existing.length === 0) {
        const salt = require("node:crypto").randomBytes(16).toString("hex");
        await connection.query(
          "INSERT INTO tenant_user (tenant_id, name, username, email, role, password, salt, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
          [1, user.name, user.username, user.email, user.role, hashPassword(user.password, salt), salt],
        );
        console.log(`Created ${user.username} user for tenant 1`);
      } else {
        await connection.query("UPDATE tenant_user SET email = COALESCE(NULLIF(email, ''), ?), status = 1 WHERE id = ?", [user.email, existing[0].id]);
      }
    }

    const [columns] = await connection.query("SHOW COLUMNS FROM tenant_user");
    const [users] = await connection.query(
      "SELECT id, tenant_id, name, username, email, role, status, last_active FROM tenant_user ORDER BY id",
    );
    console.log(`tenant_user columns: ${columns.map((column) => column.Field).join(", ")}`);
    console.table(users);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Member database initialization failed", error.message);
  process.exitCode = 1;
});
