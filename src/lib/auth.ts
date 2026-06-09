import { isValidSession } from "./sessions"
import { NextRequest, NextResponse } from "next/server"
export function requireAuth(req) {
  const token = req.cookies.get("operator_token")?.value
  if (!token || !isValidSession(token)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  return null
}
