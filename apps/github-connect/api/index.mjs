import { makeHandler } from "../src/router.mjs";
const handler = makeHandler();
export default { fetch(request) { return handler(request); } };
