import { describe, it, expect } from "vitest";
import { Command } from "commander";

function buildProgram(): { program: Command; seen: () => string | undefined } {
  let captured: string | undefined;
  const program = new Command();
  program.option("-e, --env <name>", "Target a named environment");
  program.command("sub").action(() => {
    captured = program.opts().env as string | undefined;
  });
  return { program, seen: () => captured };
}

describe("global --env option", () => {
  it("is readable via program.opts() when passed before the subcommand", async () => {
    const { program, seen } = buildProgram();
    await program.parseAsync(["-e", "dev", "sub"], { from: "user" });
    expect(seen()).toBe("dev");
  });

  it("is undefined when the flag is absent", async () => {
    const { program, seen } = buildProgram();
    await program.parseAsync(["sub"], { from: "user" });
    expect(seen()).toBeUndefined();
  });
});
