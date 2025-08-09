import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { dataUrl, filename } = body || {};

    if (!dataUrl || typeof dataUrl !== "string") {
      return NextResponse.json({ error: "Missing dataUrl" }, { status: 400 });
    }

    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json({ error: "Invalid dataUrl format" }, { status: 400 });
    }

    const mime = matches[1];
    const b64 = matches[2];
    const buffer = Buffer.from(b64, "base64");

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });

    const safeName = (filename && String(filename).replace(/[^a-zA-Z0-9._-]/g, "_")) || `geotest-arcgis-${Date.now()}.png`;
    const filePath = path.join(uploadsDir, safeName);

    await fs.writeFile(filePath, buffer);

    const url = `/uploads/${safeName}`;
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
