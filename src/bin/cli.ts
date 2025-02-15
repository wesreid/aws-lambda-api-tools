import { program } from 'commander';
import { join } from 'path';

program
  .name('aws-lambda-api-tools')
  .description('CLI tools for AWS Lambda and API Gateway')
  .version('0.1.5');

program.command('create-gha-iam-stack')
  .description('Create IAM stack for GitHub Actions OIDC authentication')
  .option('--repo <owner/repo>', 'GitHub repository (owner/repo)', collect, [])
  .option('--policy <name>', 'AWS managed policy name', 'AdministratorAccess')
  .action(async (options) => {
    if (options.repo.length === 0) {
      console.error('Error: at least one --repo argument is required');
      process.exit(1);
    }
    
    // Convert Commander options to argv format for bootstrap script
    process.argv = [
      process.argv[0],
      process.argv[1],
      ...options.repo.map((repo: string) => `--repo=${repo}`),
      `--policy=${options.policy}`
    ];
    require(join(__dirname, 'bootstrap-iam.js'));
  });

// Helper function to collect multiple --repo options
function collect(value: string, previous: string[]) {
  return previous.concat([value]);
}

program.parse(); 