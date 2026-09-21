import { describe, expect, it, vi } from "vitest";
import { createCloudflareSheetVisualExtraction } from "./sheet-visual-extraction.js";

describe("sheet visual extraction", () => {
  it("rebuilds a flat provider observation into nested document structure", async () => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        nodes: [
          { id: "a", parentId: null, kind: "section", label: "Attributes" },
          { id: "p", parentId: "a", kind: "section", label: "Physical" },
          {
            id: "s",
            parentId: "p",
            kind: "field",
            label: "Strength",
            control: { kind: "rating", constraints: { min: 0, max: 5 } },
          },
        ],
      }),
    }));
    const extraction = createCloudflareSheetVisualExtraction({ run }, "vision");

    await expect(
      extraction.extract({
        pages: [new Blob(["page"], { type: "image/jpeg" })],
      }),
    ).resolves.toMatchObject({
      document: { pageCount: 1 },
      nodes: [
        {
          label: "Attributes",
          children: [
            {
              label: "Physical",
              children: [{ label: "Strength", control: { kind: "rating" } }],
            },
          ],
        },
      ],
    });
    expect(run).toHaveBeenCalledWith(
      "vision",
      expect.objectContaining({
        max_tokens: 4096,
        response_format: {
          type: "json_schema",
          json_schema: expect.objectContaining({ required: ["nodes"] }),
        },
      }),
    );
  });

  it("uses its one repair attempt to recover hierarchy from a flat observation", async () => {
    const responses = [
      {
        response:
          '{"nodes":[{"id":"strength","parentId":null,"kind":"field","label":"Strength","control":{"kind":"rating"}},{"id":"name","parentId":null,"kind":"field","label":"Name","control":{"kind":"text"}}]}',
      },
      {
        response:
          '{"nodes":[{"id":"attributes","parentId":null,"kind":"section","label":"Attributes"},{"id":"strength","parentId":"attributes","kind":"field","label":"Strength","control":{"kind":"rating"}}]}',
      },
    ];
    const extraction = createCloudflareSheetVisualExtraction(
      { run: async () => responses.shift() ?? {} },
      "vision",
    );

    const result = await extraction.extract({
      pages: [new Blob(["page"], { type: "image/jpeg" })],
    });
    expect(result.nodes).toMatchObject([
      { label: "Attributes", children: [{ label: "Strength" }] },
      { label: "Name" },
    ]);
  });

  it("accepts Workers AI's structured response object and normalizes recoverable controls", async () => {
    const extraction = createCloudflareSheetVisualExtraction(
      {
        run: async () => ({
          response: {
            nodes: [
              {
                id: "details",
                parentId: null,
                kind: "section",
                label: " Details ",
              },
              {
                id: "name",
                parentId: "details",
                kind: "field",
                label: " Name ",
                control: { type: "text" },
                value: { unsupported: true },
                providerNote: "ignored",
              },
              {
                id: "unknown-control",
                parentId: "details",
                kind: "field",
                label: "Unknown control",
                control: {},
              },
            ],
          },
        }),
      },
      "vision",
    );

    await expect(
      extraction.extract({ pages: [new Blob(["page"])] }),
    ).resolves.toMatchObject({
      nodes: [
        {
          label: "Details",
          children: [
            { label: "Name", control: { kind: "text" } },
            { label: "Unknown control", control: { kind: "text" } },
          ],
        },
      ],
    });
  });

  it("retries an invalid provider response with a bounded repair prompt", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ response: "not json" })
      .mockResolvedValueOnce({
        response: {
          nodes: [
            {
              id: "identity",
              parentId: null,
              kind: "section",
              label: "Identity",
            },
          ],
        },
      });
    const extraction = createCloudflareSheetVisualExtraction({ run }, "vision");

    await expect(
      extraction.extract({ pages: [new Blob(["page"])] }),
    ).resolves.toMatchObject({ nodes: [{ label: "Identity" }] });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[1]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining("Return only"),
            }),
            expect.objectContaining({
              type: "image_url",
              image_url: expect.objectContaining({
                url: expect.stringContaining("data:"),
              }),
            }),
          ]),
        }),
      ]),
    });
  });

  it("normalizes a Llama Vision root/header/text tree without retaining its root", async () => {
    const extraction = createCloudflareSheetVisualExtraction(
      {
        run: async () => ({
          response: `The JSON object is as follows:\n\n[{
            "kind":"root","label":"Sheet","children":[
              {"kind":"section","label":"Physical","children":[
                {"kind":"field","label":"Strength"}
              ]}
            ]
          }`,
        }),
      },
      "vision",
    );

    await expect(
      extraction.extract({ pages: [new Blob(["page"])] }),
    ).resolves.toMatchObject({
      nodes: [
        {
          label: "Physical",
          children: [{ label: "Strength", control: { kind: "text" } }],
        },
      ],
    });
  });

  it("rejects malformed provider JSON and unknown parent references", async () => {
    const malformed = createCloudflareSheetVisualExtraction(
      { run: async () => ({ response: "{" }) },
      "vision",
    );
    await expect(
      malformed.extract({ pages: [new Blob(["page"])] }),
    ).rejects.toThrow("invalid observed structure");
    const orphan = createCloudflareSheetVisualExtraction(
      {
        run: async () => ({
          response:
            '{"nodes":[{"id":"field","parentId":"missing","kind":"field","label":"Name","control":{"kind":"text"}}]}',
        }),
      },
      "vision",
    );
    await expect(
      orphan.extract({ pages: [new Blob(["page"])] }),
    ).rejects.toThrow("invalid observed structure");
  });
});
