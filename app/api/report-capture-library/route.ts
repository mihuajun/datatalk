import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-static";

export async function GET() {
  try {
    const libraryPath = path.join(process.cwd(), "node_modules", "html2canvas", "dist", "html2canvas.min.js");
    const library = await fs.readFile(libraryPath);
    return new NextResponse(library, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ message: "截图组件不可用" }, { status: 404 });
  }
}
