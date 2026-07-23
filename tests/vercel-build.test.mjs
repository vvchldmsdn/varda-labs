import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getNpmInvocation,
  getVercelBuildSteps,
  runVercelBuild,
} from "../scripts/vercel-build.mjs";

describe("Vercel build database boundary", () => {
  it("migrates the isolated Preview database before building", () => {
    assert.deepEqual(getVercelBuildSteps("preview"), [
      "db:migrate",
      "build",
    ]);
  });

  it("keeps production, development, and local builds migration-free", () => {
    assert.deepEqual(getVercelBuildSteps("production"), ["build"]);
    assert.deepEqual(getVercelBuildSteps("development"), ["build"]);
    assert.deepEqual(getVercelBuildSteps(undefined), ["build"]);
  });

  it("requires a Preview database URL before starting any command", () => {
    assert.throws(
      () =>
        runVercelBuild({
          env: { VERCEL_ENV: "preview" },
          spawn: () => {
            throw new Error("spawn should not run");
          },
          log: () => {},
        }),
      /DATABASE_URL is required/,
    );
  });

  it("runs the reviewed Preview sequence with the current environment", () => {
    const calls = [];
    const env = {
      DATABASE_URL: "postgresql://example.invalid/preview",
      VERCEL_ENV: "preview",
      npm_execpath: "/opt/npm/bin/npm-cli.js",
    };

    runVercelBuild({
      env,
      nodeExecutable: "/usr/bin/node",
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0 };
      },
      log: () => {},
    });

    assert.deepEqual(
      calls.map(({ command, args }) => ({ command, args })),
      [
        {
          command: "/usr/bin/node",
          args: ["/opt/npm/bin/npm-cli.js", "run", "db:migrate"],
        },
        {
          command: "/usr/bin/node",
          args: ["/opt/npm/bin/npm-cli.js", "run", "build"],
        },
      ],
    );
    assert.equal(calls.every(({ options }) => options.env === env), true);
    assert.equal(calls.every(({ options }) => options.stdio === "inherit"), true);
  });

  it("stops the deployment when migration fails", () => {
    const scripts = [];

    assert.throws(
      () =>
        runVercelBuild({
          env: {
            DATABASE_URL: "postgresql://example.invalid/preview",
            VERCEL_ENV: "preview",
          },
          platform: "linux",
          spawn: (_command, args) => {
            scripts.push(args.at(-1));
            return { status: 1 };
          },
          log: () => {},
        }),
      /db:migrate failed with exit code 1/,
    );
    assert.deepEqual(scripts, ["db:migrate"]);
  });

  it("uses a platform npm executable when npm_execpath is unavailable", () => {
    assert.deepEqual(
      getNpmInvocation({
        scriptName: "build",
        nodeExecutable: "node",
        npmExecPath: undefined,
        platform: "win32",
      }),
      {
        command: "npm.cmd",
        args: ["run", "build"],
      },
    );
  });
});
