import { NextRequest, NextResponse } from "next/server";
import { load, publicState, transact } from "@/lib/store";
import { can, type Command, type State } from "@/lib/wms";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function current(req: NextRequest, state: State) {
  const user = state.users.find((u) => u.id === req.cookies.get("wms-actor")?.value && u.active) || state.users.find((u) => u.active && u.role === "Admin") || state.users.find((u) => u.active);
  if (!user) throw Error("No active user configured");
  return user;
}
function response(state: State, id: string) {
  const user = state.users.find((u) => u.id === id)!;
  return {
    state: publicState(state),
    user: { id: user.id, name: user.name, role: user.role },
  };
}
export async function GET(req: NextRequest) {
  try {
    const state = load(), user = current(req, state);
    return NextResponse.json(response(state, user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load warehouse",
      },
      { status: 500 },
    );
  }
}
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (
      !origin ||
      !["http:", "https:"].includes(new URL(origin).protocol) ||
      new URL(origin).host !== req.headers.get("host")
    )
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (Number(req.headers.get("content-length")) > 100000)
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    const raw = await req.text();
    if (raw.length > 100000)
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    const c = JSON.parse(raw) as Command;
    if (!c || Array.isArray(c) || typeof c.type !== "string")
      throw Error("Invalid operation payload");
    const state = load();
    if (c.type === "selectUser" || c.type === "login") {
      const user = state.users.find((u) => u.id === c.id && u.active);
      if (!user) throw Error("Choose an active staff member");
      const result = NextResponse.json(response(state, user.id));
      result.cookies.set("wms-actor", user.id, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
      });
      return result;
    }
    const user = (c.staffId ? state.users.find((u) => u.id === c.staffId && u.active) : null) || current(req, state);
    const next = transact(c, user);
    return NextResponse.json(response(next, user.id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operation failed" },
      { status: 400 },
    );
  }
}
