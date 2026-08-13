import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/infrastructure/auth/auth";

const handler = (request: Request) => getAuth().handler(request);

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(handler);
