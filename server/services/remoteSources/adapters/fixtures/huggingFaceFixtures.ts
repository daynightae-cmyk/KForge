/**
 * Deterministic Hugging Face Hub fixtures (Slice 4).
 *
 * Shapes follow the documented Hub record fields from the research pack
 * (section 5.4): model id, publisher, revision/SHA, tags, task, library,
 * license, gated state, files with sizes and artifact hashes, model card
 * reference, updatedAt. Unit tests MUST NOT require live Hub network; these
 * fixtures are the contract stand-ins. Optional live tests stay behind
 * KFORGE_LIVE_PROVIDER_TESTS=1.
 */

export const HF_SEARCH_FIXTURE = [
  {
    id: "Qwen/Qwen2.5-Coder-1.5B",
    author: "Qwen",
    sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    lastModified: "2026-07-01T00:00:00Z",
    private: false,
    gated: false,
    likes: 1234,
    downloads: 567890,
    tags: ["transformers", "code", "qwen2"],
    pipeline_tag: "text-generation",
    library_name: "transformers",
    license: "apache-2.0",
    siblings: [
      {
        rfilename: "config.json",
        size: 1200,
        lfs: { sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
      },
      { rfilename: "model.safetensors", size: 3200000000 },
    ],
  },
  {
    id: "acme/minimal-gated",
    author: "acme",
    sha: "f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4b5a6f1e2",
    lastModified: "2026-06-01T00:00:00Z",
    private: false,
    gated: "manual",
    likes: 12,
    tags: ["experimental"],
    siblings: [{ rfilename: "README.md", size: 800 }],
  },
];

export const HF_DETAIL_FIXTURE = {
  ...HF_SEARCH_FIXTURE[0],
  cardData: { license: "apache-2.0" },
};

export const HF_PRIVATE_FIXTURE = {
  id: "acme/private-weights",
  author: "acme",
  private: true,
  tags: [],
};
