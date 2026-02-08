import { program } from 'commander';
import { join } from 'path';

program
  .name('aws-lambda-api-tools')
  .description('CLI tools for AWS Lambda and API Gateway')
  .version('0.1.5');

program.command('create-gha-iam-stack')
  .description('Create IAM stack for GitHub Actions OIDC authentication')
  .option('--repo <owner/repo>', 'GitHub repository to add (owner/repo)', collect, [])
  .option('--remove-repo <owner/repo>', 'GitHub repository to remove (owner/repo)', collectRemove, [])
  .option('--policy <name>', 'AWS managed policy name', 'AdministratorAccess')
  .option('--mode <mode>', 'Operation mode: merge (add new repos), replace (overwrite all), list (show current repos)', 'replace')
  .option('--yes', 'Skip confirmation prompt', false)
  .option('--stack-name <name>', 'CloudFormation stack name', 'GithubActionsIam')
  .option('--role-name <name>', 'IAM role name', 'GithubActionsRole')
  .option('--max-session-duration <seconds>', 'Max session duration in seconds (default: 3600, max: 43200)', '3600')
  .action(async (options) => {
    const nodeExe = process.argv[0] ?? 'node';
    const scriptPath = process.argv[1] ?? '';
    
    // List mode - no repos required
    if (options.mode === 'list') {
      process.argv = [
        nodeExe,
        scriptPath,
        '--mode=list',
        `--stack-name=${options.stackName}`,
        `--role-name=${options.roleName}`,
      ];
      require(join(__dirname, 'bootstrap-iam.js'));
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
        '--mode=mixed',
        `--stack-name=${options.stackName}`,
        `--role-name=${options.roleName}`,
        `--max-session-duration=${options.maxSessionDuration}`,
        ...(options.yes ? ['--yes'] : [])
      ];
      require(join(__dirname, 'bootstrap-iam.js'));
      return;
    }

    // Pure remove mode - only --remove-repo specified
    if (options.removeRepo.length > 0) {
      process.argv = [
        nodeExe,
        scriptPath,
        ...options.removeRepo.map((repo: string) => `--remove-repo=${repo}`),
        `--policy=${options.policy}`,
        '--mode=remove',
        `--stack-name=${options.stackName}`,
        `--role-name=${options.roleName}`,
        `--max-session-duration=${options.maxSessionDuration}`,
        ...(options.yes ? ['--yes'] : [])
      ];
      require(join(__dirname, 'bootstrap-iam.js'));
      return;
    }

    // Add/Replace mode - requires repos
    if (options.repo.length === 0) {
      console.error('Error: at least one --repo argument is required (or use --mode=list to view current repos)');
      process.exit(1);
    }
    
    if (!['merge', 'replace'].includes(options.mode)) {
      console.error('Error: --mode must be one of: merge, replace, list');
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
      ...(options.yes ? ['--yes'] : [])
    ];
    require(join(__dirname, 'bootstrap-iam.js'));
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