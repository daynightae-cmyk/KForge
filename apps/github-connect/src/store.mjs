// Atomic, durable serverless session and delivery store; no in-memory production fallback.
const UPDATE_IF_EQUAL = "local v=redis.call('GET',KEYS[1]); if v ~= ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1";
const DELETE_IF_EQUAL = "local v=redis.call('GET',KEYS[1]); if v ~= ARGV[1] then return 0 end; return redis.call('DEL',KEYS[1])";
const RATE_LIMIT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
export class RedisStore {
  constructor(env = process.env, transport = fetch) {
    if (!env.UPSTASH_REDIS_REST_URL?.startsWith("https://") || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error("Durable Redis credentials unavailable");
    this.url = env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, "");
    this.token = env.UPSTASH_REDIS_REST_TOKEN;
    this.transport = transport;
  }
  async run(...command) {
    const res = await this.transport(this.url, {
      method: "POST", headers: {"authorization": `Bearer ${this.token}`, "content-type":"application/json"},
      body: JSON.stringify(command), signal: AbortSignal.timeout(6500)
    });
    if (!res.ok) throw new Error("Durable store unavailable");
    const json = await res.json();
    if (json.error) throw new Error("Durable store rejected command");
    return json.result;
  }
  async set(key, value, ttl, nx=false) {
    if (!Number.isInteger(ttl) || ttl < 1) throw new Error("Invalid TTL");
    return await this.run("SET",key,JSON.stringify(value),"EX",ttl,...(nx?["NX"]:[])) === "OK";
  }
  async get(key) { const r=await this.run("GET",key); return r===null?null:JSON.parse(r); }
  async consume(key) { const r=await this.run("GETDEL",key); return r===null?null:JSON.parse(r); }
  async del(key) { await this.run("DEL",key); }
  async replaceIf(key, oldValue, newValue, ttl) {
    return Number(await this.run("EVAL",UPDATE_IF_EQUAL,1,key,JSON.stringify(oldValue),JSON.stringify(newValue),ttl))===1;
  }
  async deleteIf(key, oldValue) {
    return Number(await this.run("EVAL",DELETE_IF_EQUAL,1,key,JSON.stringify(oldValue)))===1;
  }
  async limit(key,max,seconds) {
    const n=Number(await this.run("EVAL",RATE_LIMIT,1,key,seconds));
    if (!Number.isSafeInteger(n)) throw new Error("Invalid rate limit state");
    return n<=max;
  }
  async ping() { return (await this.run("PING"))==="PONG"; }
}
