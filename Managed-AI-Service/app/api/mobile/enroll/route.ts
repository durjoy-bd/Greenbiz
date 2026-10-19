import { env } from "cloudflare:workers";
import { handleMobileAi } from "@/lib/mobile-ai";

export async function POST(request: Request) {
  return handleMobileAi(request, env);
}

export async function OPTIONS(request: Request) {
  return handleMobileAi(request, env);
}

