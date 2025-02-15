#!/usr/bin/env ts-node
import { App, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { OpenIdConnectProvider, Role, WebIdentityPrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';

// Parse command line arguments
const args = process.argv.slice(2);
const repoArg = args.find(arg => arg.startsWith('--repo='));
const policyArg = args.find(arg => arg.startsWith('--policy='));

if (!repoArg) {
  console.error('Error: --repo argument is required');
  console.error('Usage: gh-oidc-iam --repo=owner/repo-name [--policy=PolicyName]');
  console.error('Example: gh-oidc-iam --repo=myorg/my-repo --policy=AdministratorAccess');
  process.exit(1);
}

const repoName = repoArg.split('=')[1];
const policyName = policyArg ? policyArg.split('=')[1] : 'AdministratorAccess';

const app = new App();

class GithubActionsIamStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const githubOidcProvider = new OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deploymentRole = new Role(this, 'GithubActionsRole', {
      assumedBy: new WebIdentityPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${repoName}:*`,
          },
        }
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(policyName!),
      ],
    });

    new CfnOutput(this, 'RoleArn', {
      value: deploymentRole.roleArn,
      description: 'ARN of role to use in GitHub Actions',
    });
  }
}

new GithubActionsIamStack(app, 'GithubActionsIam');
app.synth(); 