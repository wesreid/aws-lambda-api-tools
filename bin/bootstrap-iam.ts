#!/usr/bin/env ts-node
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

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

const app = new cdk.App();

class GithubActionsIamStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deploymentRole = new iam.Role(this, 'GithubActionsRole', {
      assumedBy: new iam.WebIdentityPrincipal(
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
        iam.ManagedPolicy.fromAwsManagedPolicyName(policyName),
      ],
    });

    new cdk.CfnOutput(this, 'RoleArn', {
      value: deploymentRole.roleArn,
      description: 'ARN of role to use in GitHub Actions',
    });
  }
}

new GithubActionsIamStack(app, 'GithubActionsIam');
app.synth(); 