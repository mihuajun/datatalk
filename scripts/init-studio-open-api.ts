import { ensureOpenApiSchema } from "../lib/server/open-api-schema";
import { getDbPool } from "../lib/server/mysql";
ensureOpenApiSchema().then(() => console.log("Studio API schema initialized")).finally(() => getDbPool().end()).catch(() => { console.error("Studio API schema initialization failed; check database permissions and config"); process.exitCode = 1; });
