export default {
  async fetch(): Promise<Response> {
    return Response.json({
      status: "renderer entry is a typecheck-only module",
    });
  },
};
