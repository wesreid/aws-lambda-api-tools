import { program } from "commander";
import { join } from "path";
import {
  generateRouteModules,
  checkRouteModules,
} from "../lib/route-modules-generator";

program
  .name("aws-lambda-api-tools")
  .description("CLI tools for AWS Lambda and API Gateway")
  .version("0.1.5");

program
  .command("create-gha-iam-stack")
  .description("Create IAM stack for GitHub Actions OIDC authentication")
  .option(
    "--repo <owner/repo>",
    "GitHub repository to add (owner/repo)",
    collect,
    []
  )
  .option(
    "--remove-repo <owner/repo>",
    "GitHub repository to remove (owner/repo)",
    collectRemove,
    []
  )
  .option("--policy <name>", "AWS managed policy name", "AdministratorAccess")
  .option(
    "--mode <mode>",
    "Operation mode: merge (add new repos), replace (overwrite all), list (show current repos)",
    "replace"
  )
  .option("--yes", "Skip confirmation prompt", false)
  .option(
    "--stack-name <name>",
    "CloudFormation stack name",
    "GithubActionsIam"
  )
  .option("--role-name <name>", "IAM role name", "GithubActionsRole")
  .option(
    "--max-session-duration <seconds>",
    "Max session duration in seconds (default: 3600, max: 43200)",
    "3600"
  )
  .action(async (options) => {
    const nodeExe = process.argv[0] ?? "node";
    const scriptPath = process.argv[1] ?? "";

    // List mode - no repos required
    if (options.mode === "list") {
      process.argv = [
        nodeExe,
        scriptPath,
        "--mode=list",
        `--stack-name=${options.stackName}`,
        `--role-name=${options.roleName}`,
      ];
      require(join(__dirname, "bootstrap-iam.js"));
      return;
    }

    // Mixed mode - both --repo and --remove-repo specified
    if (options.repo.length > 0 && options.removeRepo.length > 0) {
      process.argv = [
        nodeExe,
        scriptPath,
        ...options.repo.map((repo: string) => `--repo=${repo}`),
        ...options.removeRepo.map((repo: string) => `--remove-repo=${repo}`),
        `--policy=${options.policy}`,
        "--mode=mixed",
        `--stack-name=${options.stackName}`,
        `--role-name=${options.roleName}`,
        `--max-session-duration=${options.maxSessionDuration}`,
        ...(options.yes ? ["--yes"] : []),
      ];
      require(join(__dirname, "bootstrap-iam.js"));
      return;
    }

    // Pure remove mode - only --remove-repo specified
    if (options.removeRepo.length > 0) {
      process.argv = [
        nodeExe,
        scriptPath,
        ...options.removeRepo.map((repo: string) => `--remove-repo=${repo}`),
        `--policy=${options.policy}`,
        "--mode=remove",
        `--stack-name=${options.stackName}`,
        `--role-name=${options.roleName}`,
        `--max-session-duration=${options.maxSessionDuration}`,
        ...(options.yes ? ["--yes"] : []),
      ];
      require(join(__dirname, "bootstrap-iam.js"));
      return;
    }

    // Add/Replace mode - requires repos
    if (options.repo.length === 0) {
      console.error(
        "Error: at least one --repo argument is required (or use --mode=list to view current repos)"
      );
      process.exit(1);
    }

    if (!["merge", "replace"].includes(options.mode)) {
      console.error("Error: --mode must be one of: merge, replace, list");
      process.exit(1);
    }

    // Convert Commander options to argv format for bootstrap script
    process.argv = [
      nodeExe,
      scriptPath,
      ...options.repo.map((repo: string) => `--repo=${repo}`),
      `--policy=${options.policy}`,
      `--mode=${options.mode}`,
      `--stack-name=${options.stackName}`,
      `--role-name=${options.roleName}`,
      `--max-session-duration=${options.maxSessionDuration}`,
      ...(options.yes ? ["--yes"] : []),
    ];
    require(join(__dirname, "bootstrap-iam.js"));
  });

program
  .command("generate-route-modules")
  .description(
    "Generate the static route-modules map from *_routes-config files. Keeps the " +
      "esbuild-bundled handler map in lockstep with the route config (a missing " +
      "entry is a silent 404 at runtime)."
  )
  .option(
    "--routes-dir <dir>",
    "directory scanned recursively for route-config files",
    "src/routes"
  )
  .option("--out <path>", "output file path", "src/route-modules.ts")
  .option(
    "--type-import <module>",
    "module to import the RouteModule type from",
    "aws-lambda-api-tools"
  )
  .option(
    "--check",
    "verify the file is up to date; exit non-zero if stale (for CI/pre-commit)",
    false
  )
  .action(async (options) => {
    const opts = {
      routesDir: options.routesDir,
      outFile: options.out,
      typeImportFrom: options.typeImport,
    };

    if (options.check) {
      const result = await checkRouteModules(opts);
      if (result.inSync) {
        console.log(`\u2713 ${options.out} is in sync with the route config.`);
        return;
      }
      console.error(
        `\u2717 ${options.out} is out of date with the route config.`
      );
      if (result.missing.length > 0) {
        console.error(
          "  Declared in config but NOT registered (these 404 at runtime):"
        );
        for (const hp of result.missing) console.error(`    - ${hp}`);
      }
      if (result.extra.length > 0) {
        console.error(
          "  Registered but NOT declared in config (dead entries):"
        );
        for (const hp of result.extra) console.error(`    - ${hp}`);
      }
      console.error("  Fix: npx aws-lambda-api-tools generate-route-modules");
      process.exit(1);
    }

    const result = await generateRouteModules(opts);
    console.log(
      `${result.changed ? "\u2713 wrote" : "\u2713 up to date"} ${
        options.out
      } ` + `(${result.handlerPaths.length} routes).`
    );
  });

// Helper function to collect multiple --repo options
function collect(value: string, previous: string[]) {
  return previous.concat([value]);
}

// Helper function to collect multiple --remove-repo options
function collectRemove(value: string, previous: string[]) {
  return previous.concat([value]);
}

program.parse();
