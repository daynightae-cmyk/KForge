/**
 * Deterministic NuGet fixtures (P1-3).
 */

export const NUGET_SEARCH_FIXTURE = {
  totalHits: 2,
  data: [
    {
      id: "Newtonsoft.Json",
      version: "13.0.3",
      description: "Json.NET is a popular high-performance JSON framework for .NET",
      authors: "James Newton-King",
      tags: ["json", "dotnet"],
      totalDownloads: 100000000,
      verified: true,
      projectUrl: "https://www.newtonsoft.com/json",
      licenseUrl: "https://raw.githubusercontent.com/JamesNK/Newtonsoft.Json/master/LICENSE.md",
    },
    {
      id: "Minimal.Pkg",
      version: "0.1.0",
      description: "Minimal package without licenseUrl.",
      authors: "Acme",
      tags: ["minimal"],
      totalDownloads: 100,
      verified: false,
    },
  ],
};

export const NUGET_REGISTRATION_FIXTURE = {
  count: 2,
  items: [
    {
      items: [
        {
          catalogEntry: {
            id: "Newtonsoft.Json",
            version: "13.0.3",
            description: "Json.NET is a popular high-performance JSON framework for .NET",
            authors: "James Newton-King",
            tags: ["json"],
            licenseUrl: "https://raw.githubusercontent.com/JamesNK/Newtonsoft.Json/master/LICENSE.md",
            projectUrl: "https://www.newtonsoft.com/json",
            listed: true,
          },
          packageContent: "https://api.nuget.org/v3-flatcontainer/newtonsoft.json/13.0.3/newtonsoft.json.13.0.3.nupkg",
        },
      ],
    },
    {
      items: [
        {
          catalogEntry: {
            id: "Newtonsoft.Json",
            version: "13.0.2",
            description: "Previous version",
            authors: "James Newton-King",
            tags: ["json"],
            licenseUrl: "https://raw.githubusercontent.com/JamesNK/Newtonsoft.Json/master/LICENSE.md",
            projectUrl: "https://www.newtonsoft.com/json",
            listed: true,
          },
          packageContent: "https://api.nuget.org/v3-flatcontainer/newtonsoft.json/13.0.2/newtonsoft.json.13.0.2.nupkg",
        },
      ],
    },
  ],
};
