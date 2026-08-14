import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 51 * 1024 * 1024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ markdownId: string; assetPath?: string[] }>;
};

function errorResponse(message: string, status: number): Response {
  return Response.json({ detail: message }, { status });
}

function backendAuthorization(request: NextRequest): string {
  return (
    process.env.UPLOAD_API_KEY ||
    process.env.LANGGRAPH_API_KEY ||
    request.cookies.get("session_token")?.value ||
    ""
  );
}

function backendBaseUrl(): string {
  return (
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_LANGGRAPH_URL ||
    "http://localhost:2024"
  ).replace(/\/+$/, "");
}

function assetSuffix(assetPath: string[] | undefined): string | null {
  if (!assetPath || assetPath.length === 0) return "";
  if (!UUID_RE.test(assetPath[0])) return null;
  if (assetPath.length === 1) return `/${assetPath[0]}`;
  if (assetPath.length === 2 && assetPath[1] === "download") {
    return `/${assetPath[0]}/download`;
  }
  return null;
}

async function proxyMarkdownImageRequest(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const { markdownId, assetPath } = await context.params;
  if (!/^\d{6}$/.test(markdownId)) {
    return errorResponse("Markdown ID must contain exactly six digits", 422);
  }

  const suffix = assetSuffix(assetPath);
  if (suffix === null) return errorResponse("Invalid image asset path", 422);
  if (request.method === "GET" && suffix === "") {
    return errorResponse("Image asset ID is required", 405);
  }
  if (request.method !== "GET" && suffix !== "") {
    return errorResponse("Image mutation path is invalid", 405);
  }

  const authorization = backendAuthorization(request);
  if (!authorization) {
    return errorResponse(
      "Markdown image backend credentials are not configured",
      401
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("Image upload request is too large", 413);
  }

  const body = request.method === "POST" ? await request.formData() : undefined;
  let backendResponse: Response;
  try {
    backendResponse = await fetch(
      `${backendBaseUrl()}/markdown-threads/${markdownId}/images${suffix}`,
      {
        method: request.method,
        headers: { "X-API-Key": authorization },
        body,
        cache: "no-store",
      }
    );
  } catch {
    return errorResponse("Markdown image backend is unavailable", 502);
  }

  const headers = new Headers();
  for (const name of [
    "cache-control",
    "content-disposition",
    "content-length",
    "content-type",
    "retry-after",
    "x-content-type-options",
  ]) {
    const value = backendResponse.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    headers,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyMarkdownImageRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyMarkdownImageRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyMarkdownImageRequest(request, context);
}
