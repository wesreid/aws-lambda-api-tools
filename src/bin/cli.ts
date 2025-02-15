import { program } from 'commander';
import { join } from 'path';

program
  .name('aws-lambda-api-tools')
  .description('CLI tools for AWS Lambda and API Gateway')
  .version('0.1.5');

program.command('create-gha-iam-stack')
  .description('Create IAM stack for GitHub Actions OIDC authentication')
  .requiredOption('--repo <owner/repo>', 'GitHub repository (owner/repo)')
  .option('--policy <name>', 'AWS managed policy name', 'AdministratorAccess')
  .action(async (options) => {
    process.argv = [
      process.argv[0],
      process.argv[1],
      `--repo=${options.repo}`,
      `--policy=${options.policy}`
    ];
    require(join(__dirname, 'bootstrap-iam.js'));
  });

program.parse(); 