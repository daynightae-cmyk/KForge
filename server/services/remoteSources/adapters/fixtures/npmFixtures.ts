/**
 * Deterministic npm Registry fixtures (Slice P1-1).
 *
 * Shapes follow documented registry fields: search objects with package
 * metadata, package detail with dist-tags/versions/time, and version detail
 * with dist shasum/integrity. Unit tests MUST NOT require live npm network.
 */

export const NPM_SEARCH_FIXTURE = {
  objects: [
    {
      package: {
        name: "left-pad",
        scope: "unscoped",
        version: "1.3.0",
        description: "String left pad",
        keywords: ["pad", "string"],
        date: "2018-04-01T00:00:00.000Z",
        links: { npm: "https://www.npmjs.com/package/left-pad", repository: "https://github.com/stevemao/left-pad" },
        publisher: { username: "stevemao", email: "stevemao@example.com" },
        maintainers: [{ username: "stevemao", email: "stevemao@example.com" }],
      },
      score: { final: 0.99, detail: { quality: 0.9, popularity: 0.9, maintenance: 0.9 } },
    },
    {
      package: {
        name: "@babel/core",
        scope: "babel",
        version: "7.22.0",
        description: "Babel compiler core.",
        keywords: ["babel", "compiler"],
        date: "2023-06-01T00:00:00.000Z",
        links: { npm: "https://www.npmjs.com/package/@babel/core" },
        publisher: { username: "babel-bot" },
        maintainers: [{ username: "babel-bot" }],
      },
      score: { final: 0.95, detail: { quality: 0.95, popularity: 0.95, maintenance: 0.8 } },
    },
  ],
  total: 2,
  time: "Mon Sep 24 2026 00:00:00 GMT+0000 (UTC)",
};

export const NPM_PACKAGE_FIXTURE = {
  name: "left-pad",
  description: "String left pad - fixture",
  "dist-tags": { latest: "1.3.0", next: "2.0.0-beta" },
  versions: {
    "1.3.0": {
      name: "left-pad",
      version: "1.3.0",
      description: "String left pad",
      license: "WTFPL",
      dist: {
        tarball: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
        shasum: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        integrity: "sha512-aaaaaaaaabbbbbbbbbccccccccddddddddeeeeeeeeffffffffgggggggghhhhhhhhiiiiiiii",
      },
      dependencies: {},
      keywords: ["pad"],
    },
    "1.2.0": {
      name: "left-pad",
      version: "1.2.0",
      dist: { tarball: "https://registry.npmjs.org/left-pad/-/left-pad-1.2.0.tgz", shasum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    },
  },
  time: { created: "2016-01-01T00:00:00.000Z", modified: "2018-04-01T00:00:00.000Z", "1.3.0": "2018-04-01T00:00:00.000Z" },
  maintainers: [{ name: "stevemao", email: "stevemao@example.com" }],
  author: { name: "Steven Mao" },
  license: "WTFPL",
  repository: { type: "git", url: "git+https://github.com/stevemao/left-pad.git" },
  homepage: "https://github.com/stevemao/left-pad#readme",
};

export const NPM_VERSION_FIXTURE = NPM_PACKAGE_FIXTURE.versions["1.3.0"];

export const NPM_SEARCH_EMPTY_FIXTURE = { objects: [], total: 0, time: "Mon Sep 24 2026 00:00:00 GMT+0000 (UTC)" };
