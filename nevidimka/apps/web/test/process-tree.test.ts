import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { stopServerTree } from "./process-tree.js";

test("POSIX teardown terminates a forked server and frees its port", { skip: process.platform === "win32", timeout: 15000 }, async () => {
  const childCode = `require('node:net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)});`;
  const parentCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:['ignore',1,2]});setInterval(()=>{},1000);`;
  const server = spawn(process.execPath, ["-e", parentCode], { detached: true, stdio: "pipe" });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture did not start")), 5000);
      server.stdout!.once("data", data => { clearTimeout(timer); resolve(Number(String(data).trim())); });
      server.once("error", reject);
    });
    assert.ok(port > 0);
    await stopServerTree(server);
    const probe = createServer();
    await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } finally { await stopServerTree(server); }
});
