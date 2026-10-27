const API="https://api.github.com";
export async function githubToken(params,env,transport=fetch) {
  const response=await transport("https://github.com/login/oauth/access_token",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","accept":"application/json","user-agent":"KNOuX-Forge-Connect"},
    body:new URLSearchParams({client_id:env.KFORGE_GITHUB_CLIENT_ID,client_secret:env.KFORGE_GITHUB_CLIENT_SECRET,...params}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok) throw new Error("GitHub authorization endpoint unavailable");
  const data=await response.json();
  if(data.error || typeof data.access_token!=="string" || !data.access_token) throw new Error("GitHub authorization rejected");
  return data;
}
export async function githubGet(token,pathname,transport=fetch) {
  if(typeof token!=="string" || !token || !/^\/[\w\-./?=&%]+$/.test(pathname) || pathname.includes("..")) throw new Error("Invalid GitHub path");
  const response=await transport(API+pathname,{
    headers:{"authorization":`Bearer ${token}`,"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28","user-agent":"KNOuX-Forge-Connect"},
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return response.json();
}
export function publicAccount(u) {
  return {id:u.id,login:u.login,
    avatar_url:typeof u.avatar_url==="string" && u.avatar_url.startsWith("https://avatars.githubusercontent.com/")?u.avatar_url:null,
    html_url:typeof u.html_url==="string" && /^https:\/\/github\.com\/[\w-]+$/.test(u.html_url)?u.html_url:null};
}

// GitHub App token revocation; Basic credentials remain server-side.
export async function githubRevoke(accessToken, env, transport = fetch) {
  if (!accessToken || !env.KFORGE_GITHUB_CLIENT_SECRET) return false;
  const authorization = Buffer.from(`${env.KFORGE_GITHUB_CLIENT_ID}:${env.KFORGE_GITHUB_CLIENT_SECRET}`).toString("base64");
  const response = await transport(`https://api.github.com/applications/${encodeURIComponent(env.KFORGE_GITHUB_CLIENT_ID)}/token`, {
    method: "DELETE",
    headers: { "authorization": `Basic ${authorization}`, "accept":"application/vnd.github+json", "content-type":"application/json", "user-agent":"KNOuX-Forge-Connect" },
    body: JSON.stringify({access_token:accessToken}), signal: AbortSignal.timeout(10000)
  });
  return response.status === 204;
}
