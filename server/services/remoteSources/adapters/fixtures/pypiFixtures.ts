/**
 * Deterministic PyPI fixtures (Slice P1-2).
 */

export const PYPI_PACKAGE_FIXTURE = {
  info: {
    name: "requests",
    version: "2.31.0",
    summary: "Python HTTP for Humans.",
    description: "Requests is a simple, yet elegant, HTTP library.",
    author: "Kenneth Reitz",
    author_email: "me@kennethreitz.org",
    license: "Apache 2.0",
    home_page: "https://requests.readthedocs.io",
    project_urls: { Repository: "https://github.com/psf/requests", Homepage: "https://requests.readthedocs.io" },
    requires_dist: ["charset-normalizer (<4,>=2)", "idna (<4,>=2.5)"],
    classifiers: ["License :: OSI Approved :: Apache Software License", "Programming Language :: Python :: 3"],
    keywords: "http,requests",
  },
  releases: {
    "2.31.0": [
      {
        filename: "requests-2.31.0-py3-none-any.whl",
        url: "https://files.pythonhosted.org/packages/requests-2.31.0-py3-none-any.whl",
        digests: { sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", md5: "abc" },
        size: 62000,
        requires_python: ">=3.7",
        upload_time_iso_8601: "2023-05-22T00:00:00.000Z",
      },
    ],
    "2.30.0": [
      {
        filename: "requests-2.30.0-py3-none-any.whl",
        url: "https://files.pythonhosted.org/packages/requests-2.30.0-py3-none-any.whl",
        digests: { sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        size: 61000,
      },
    ],
  },
  urls: [
    {
      filename: "requests-2.31.0-py3-none-any.whl",
      url: "https://files.pythonhosted.org/packages/requests-2.31.0-py3-none-any.whl",
      digests: { sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
      size: 62000,
    },
  ],
  last_serial: 123456,
};

export const PYPI_MINIMAL_FIXTURE = {
  info: {
    name: "minimal-pkg",
    version: "0.1.0",
    summary: "Minimal package without digests or license.",
  },
  releases: { "0.1.0": [{ filename: "minimal-pkg-0.1.0.tar.gz", url: "https://files.pythonhosted.org/packages/minimal-pkg-0.1.0.tar.gz", digests: {} }] },
  urls: [],
  last_serial: 1,
};
