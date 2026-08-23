import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exec")>();
  return { ...actual, runCommand: vi.fn() };
});

import { ExecuteLatchError, runCommand } from "./exec";
import {
  nginxReload,
  nginxTest,
  pleskCertPaths,
  renderAppVhost,
  renderRedirectVhost,
  writeVhost,
} from "./nginx";

const mockedRun = vi.mocked(runCommand);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const app = renderAppVhost({
  domain: "new.example.com",
  ...pleskCertPaths("new.example.com"),
  listenAddress: "203.0.113.9",
});
const redirect = renderRedirectVhost({
  fromDomain: "old.example.com",
  toOrigin: "https://new.example.com",
});

describe("renderAppVhost", () => {
  it("keeps the two load-bearing blocks: proxy buffers (502 fix) and ACME", () => {
    expect(app).toContain("proxy_buffer_size       32k;");
    expect(app).toContain("proxy_buffers           16 16k;");
    expect(app).toContain("proxy_busy_buffers_size 64k;");
    expect(app).toContain("location ^~ /.well-known/acme-challenge/");
    expect(app).toContain("root /var/www/vhosts/default/htdocs;");
  });

  it("proxies to the app with forwarded host/proto and explicit listen address", () => {
    expect(app).toContain("proxy_pass http://127.0.0.1:3002;");
    expect(app).toContain("proxy_set_header X-Forwarded-Host $host;");
    expect(app).toContain("proxy_set_header X-Forwarded-Proto https;");
    expect(app).toContain("listen 203.0.113.9:443 ssl;");
    expect(app).toContain("listen 203.0.113.9:80;");
    expect(app).toContain("server_name new.example.com;");
    expect(app).toContain(
      "ssl_certificate     /opt/psa/var/modules/letsencrypt/etc/live/new.example.com/fullchain.pem;",
    );
  });

  it("derives a per-domain map variable so two vhosts never collide", () => {
    const other = renderAppVhost({ domain: "second.example.com", certPath: "/c", keyPath: "/k" });
    const varOf = (conf: string) => conf.match(/map \$http_upgrade \$(\S+) \{/)?.[1];
    expect(varOf(app)).toBeDefined();
    expect(varOf(app)).not.toBe(varOf(other));
    expect(other).toContain("listen 443 ssl;"); // bare listen when no address given
  });

  it("renders ASCII-only config (no RTL text in nginx files)", () => {
    expect(/[֐-׿]/.test(app)).toBe(false);
    expect(/[֐-׿]/.test(redirect)).toBe(false);
  });
});

describe("renderRedirectVhost", () => {
  it("301s everything to the new origin with the request URI preserved", () => {
    expect(redirect).toContain("return 301 https://new.example.com$request_uri;");
  });

  it("keeps /api/ proxying (POST callers do not survive a 301) BEFORE the 301", () => {
    expect(redirect).toContain("location /api/ {");
    expect(redirect.indexOf("location /api/ {")).toBeLessThan(
      redirect.indexOf("return 301 https://new.example.com$request_uri;"),
    );
    // and the /api/ block really proxies, not redirects:
    const apiBlock = redirect.slice(redirect.indexOf("location /api/ {"));
    expect(apiBlock).toContain("proxy_pass http://127.0.0.1:3002;");
  });

  it("keeps ACME reachable on the old domain (cert renewals must not break)", () => {
    expect(redirect).toContain("location ^~ /.well-known/acme-challenge/");
    expect(redirect).toContain(
      "ssl_certificate     /opt/psa/var/modules/letsencrypt/etc/live/old.example.com/fullchain.pem;",
    );
  });
});

describe("execute latch on mutations", () => {
  it("writeVhost refuses without RELOCATE_EXECUTE=1, before any command runs", async () => {
    vi.stubEnv("RELOCATE_EXECUTE", "");
    await expect(writeVhost("/etc/nginx/conf.d/x.conf", "server {}")).rejects.toBeInstanceOf(
      ExecuteLatchError,
    );
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("nginxReload refuses without the latch and reloads via sudo with it", async () => {
    vi.stubEnv("RELOCATE_EXECUTE", "");
    await expect(nginxReload()).rejects.toBeInstanceOf(ExecuteLatchError);

    vi.stubEnv("RELOCATE_EXECUTE", "1");
    mockedRun.mockResolvedValue({ ok: true, code: 0, stdout: "", stderr: "", command: "" });
    await nginxReload();
    expect(mockedRun).toHaveBeenCalledWith({
      cmd: "systemctl",
      args: ["reload", "nginx"],
      sudo: true,
    });
  });
});

describe("nginx operations", () => {
  it("nginxTest runs `nginx -t` via sudo and treats exit 0 as pass (warnings kept for display)", async () => {
    mockedRun.mockResolvedValue({
      ok: true,
      code: 0,
      stdout: "",
      stderr: "nginx: conflicting server name ...\nnginx: configuration file test is successful",
      command: "sudo -n nginx -t",
    });
    const res = await nginxTest();
    expect(mockedRun).toHaveBeenCalledWith({ cmd: "nginx", args: ["-t"], sudo: true });
    expect(res.ok).toBe(true);
    expect(res.output).toContain("conflicting server name");
  });

  it("writeVhost backs up an existing target then copies the staged file via sudo", async () => {
    vi.stubEnv("RELOCATE_EXECUTE", "1");
    mockedRun.mockResolvedValue({ ok: true, code: 0, stdout: "", stderr: "", command: "" });
    const { path, backupPath } = await writeVhost("/etc/nginx/conf.d/x.conf", "server {}");
    expect(path).toBe("/etc/nginx/conf.d/x.conf");
    expect(backupPath).toMatch(/x\.conf\.bak-\d{8}-\d{6}$/);
    const calls = mockedRun.mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({ cmd: "test", args: ["-e", "/etc/nginx/conf.d/x.conf"], sudo: true });
    expect(calls[1]?.cmd).toBe("cp"); // backup copy
    expect(calls[2]?.cmd).toBe("cp"); // staged → target
    expect(calls[2]?.args?.[1]).toBe("/etc/nginx/conf.d/x.conf");
  });
});
