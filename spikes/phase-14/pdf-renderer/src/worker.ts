import { renderCharacterSheetSpike } from "./renderer";

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/sample.pdf") {
      const pdf = await renderCharacterSheetSpike({ prefilled: false });
      return new Response(new Uint8Array(pdf), {
        headers: { "content-type": "application/pdf" },
      });
    }

    if (path === "/sample-npc.pdf") {
      const pdf = await renderCharacterSheetSpike({ prefilled: true });
      return new Response(new Uint8Array(pdf), {
        headers: { "content-type": "application/pdf" },
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
