import { App, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { OpenIdConnectProvider, Role, WebIdentityPrincipal, ManagedPolicy, CfnOIDCProvider } from 'aws-cdk-lib/aws-iam';
import { execSync } from 'child_process';
import { join } from 'path';

console.log('Starting GitHub OIDC IAM setup...');

// Parse command line arguments
const args = process.argv.slice(2);
const repoArg = args.find(t => t.startsWith("--repo="));
const policyArg = args.find(t => t.startsWith("--policy="));

if (!repoArg) {
  console.error("Error: --repo argument is required");
  console.error("Usage: gh-oidc-iam --repo=owner/repo-name [--policy=PolicyName]");
  console.error("Example: gh-oidc-iam --repo=myorg/my-repo --policy=AdministratorAccess");
  process.exit(1);
}

const repoName = repoArg.split("=")[1];
const policyName = policyArg ? policyArg.split("=")[1] : "AdministratorAccess";

console.log(`Configuring for repository: ${repoName}`);
console.log(`Using policy: ${policyName}`);

const app = new App();

class GithubActionsIamStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    console.log('Creating OIDC Provider...');
    const githubOidcProvider = new CfnOIDCProvider(this, "GithubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIdList: ["sts.amazonaws.com"],
      thumbprintList: [
        "6938fd4d98bab03faadb97b34396831e3780aea1",
        "1c58a3a8518e8759bf075b76b750d4f2df264fcd"
      ]
    });

    console.log('Creating IAM Role...');
    const deploymentRole = new Role(this, "GithubActionsRole", {
      assumedBy: new WebIdentityPrincipal(
        githubOidcProvider.attrArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": `repo:${repoName}:*`
          }
        }
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(policyName)
      ]
    });

    new CfnOutput(this, "RoleArn", {
      value: deploymentRole.roleArn,
      description: "ARN of role to use in GitHub Actions"
    });
  }
}

console.log('Creating CloudFormation stack...');
new GithubActionsIamStack(app, "GithubActionsIam");

console.log('Synthesizing CloudFormation template...');
const assembly = app.synth();

// Execute the deployment
console.log('Starting deployment...');
try {
  const cdkCommand = [
    'cdk deploy',
    'GithubActionsIam',
    '--require-approval never',
    `--app "${assembly.directory}"`,
  ].join(' ');

  console.log(`Executing: ${cdkCommand}`);
  
  execSync(cdkCommand, {
    stdio: 'inherit',
    env: {
      ...process.env,
      AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    }
  });
  
  console.log('Deployment completed successfully!');
} catch (error) {
  console.error('Deployment failed:', error);
  process.exit(1);
} 