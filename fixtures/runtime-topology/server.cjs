const http = require("node:http");
const port = Number(process.env.PORT);
http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><head><title>Topology fixture</title></head><body><h1>TOPOLOGY_FIXTURE</h1><p>${request.url}</p></body></html>`);
}).listen(port, "127.0.0.1", () => console.log(`TOPOLOGY_FIXTURE_READY:${port}`));
