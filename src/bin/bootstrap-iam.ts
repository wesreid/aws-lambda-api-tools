import { App, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Role, WebIdentityPrincipal, ManagedPolicy, CfnOIDCProvider } from 'aws-cdk-lib/aws-iam';
import { execSync } from 'child_process';
import { IAMClient, ListOpenIDConnectProvidersCommand, GetRoleCommand, NoSuchEntityException } from '@aws-sdk/client-iam';
import * as readline from 'readline';

console.log('🚀 Starting GitHub OIDC IAM setup...\n');

// Parse command line arguments
const args = process.argv.slice(2);
const repoArgs = args.filter(t => t.startsWith("--repo=")).map(t => t.split("=")[1]);
const removeRepoArgs = args.filter(t => t.startsWith("--remove-repo=")).map(t => t.split("=")[1]);
const policyArg = args.find(t => t.startsWith("--policy="));
const modeArg = args.find(t => t.startsWith("--mode="));
const yesArg = args.find(t => t === "--yes");
const stackNameArg = args.find(t => t.startsWith("--stack-name="));
const roleNameArg = args.find(t => t.startsWith("--role-name="));

const mode = modeArg ? modeArg.split("=")[1] as 'merge' | 'replace' | 'remove' | 'mixed' | 'list' : 'replace';
const stackName = stackNameArg ? stackNameArg.split("=")[1] : 'GithubActionsIam';
const roleName = roleNameArg ? roleNameArg.split("=")[1] : 'GithubActionsRole';

// List mode doesn't require repos
if (mode !== 'list' && repoArgs.length === 0 && removeRepoArgs.length === 0) {
  console.error("❌ Error: at least one --repo or --remove-repo argument is required");
  console.error("Usage: create-gha-iam-stack --repo=owner/repo-name [--repo=owner/another-repo] [--policy=PolicyName] [--mode=merge|replace|list]");
  console.error("       create-gha-iam-stack --remove-repo=owner/repo-name [--remove-repo=owner/another-repo]");
  console.error("       create-gha-iam-stack --repo=owner/new-repo --remove-repo=owner/old-repo");
  console.error("       create-gha-iam-stack --mode=list");
  console.error("Example: create-gha-iam-stack --repo=myorg/my-repo --repo=myorg/another-repo --policy=AdministratorAccess --mode=merge");
  console.error("Example: create-gha-iam-stack --remove-repo=myorg/old-repo");
  console.error("Example: create-gha-iam-stack --repo=myorg/new-repo --remove-repo=myorg/old-repo");
  console.error("Example: create-gha-iam-stack --mode=list");
  process.exit(1);
}

const requestedRepos = repoArgs;
const reposToRemove = removeRepoArgs;
const policyName = policyArg ? policyArg.split("=")[1] : "AdministratorAccess";
const skipConfirmation = yesArg !== undefined;

// Utility function to prompt for confirmation
function promptConfirmation(message: string): Promise<boolean> {
  if (skipConfirmation) {
    return Promise.resolve(true);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// Extract repos from existing trust policy
function extractReposFromTrustPolicy(trustPolicy: any): string[] {
  try {
    const statements = trustPolicy.Statement || [];
    for (const statement of statements) {
      if (statement.Condition?.StringLike?.['token.actions.githubusercontent.com:sub']) {
        const subs = statement.Condition.StringLike['token.actions.githubusercontent.com:sub'];
        const subArray = Array.isArray(subs) ? subs : [subs];
        return subArray
          .map((sub: string) => sub.replace('repo:', '').replace(':*', ''))
          .filter((repo: string) => repo.length > 0);
      }
    }
  } catch (error) {
    console.warn('⚠️  Could not parse trust policy:', error);
  }
  return [];
}

// Check if GitHub OIDC provider already exists
async function checkOidcProviderExists(): Promise<boolean> {
  try {
    const iamClient = new IAMClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const command = new ListOpenIDConnectProvidersCommand({});
    const response = await iamClient.send(command);
    
    const githubProvider = response.OpenIDConnectProviderList?.find(
      provider => provider.Arn?.includes('token.actions.githubusercontent.com')
    );
    
    if (githubProvider) {
      console.log(`✅ Found existing GitHub OIDC provider: ${githubProvider.Arn}`);
      return true;
    } else {
      console.log('ℹ️  No existing GitHub OIDC provider found - will create new one');
      return false;
    }
  } catch (error) {
    console.log('⚠️  Could not check for existing OIDC provider:', error);
    return false;
  }
}

// Check for existing IAM role and get current repos
async function getExistingRepos(): Promise<string[]> {
  try {
    const iamClient = new IAMClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const command = new GetRoleCommand({ RoleName: roleName });
    const response = await iamClient.send(command);
    
    if (response.Role?.AssumeRolePolicyDocument) {
      const trustPolicyJson = decodeURIComponent(response.Role.AssumeRolePolicyDocument);
      const trustPolicy = JSON.parse(trustPolicyJson);
      const existingRepos = extractReposFromTrustPolicy(trustPolicy);
      
      if (existingRepos.length > 0) {
        console.log(`\n✅ Found existing IAM role: ${roleName}`);
        console.log(`📋 Current repositories (${existingRepos.length}):`);
        existingRepos.forEach(repo => console.log(`   - ${repo}`));
        return existingRepos;
      }
    }
  } catch (error) {
    if (error instanceof NoSuchEntityException || (error as any).name === 'NoSuchEntity') {
      console.log(`\nℹ️  No existing IAM role found - will create new role: ${roleName}`);
    } else {
      console.warn('⚠️  Could not check for existing role:', error);
    }
  }
  return [];
}

// Calculate final repos list based on mode
function calculateFinalRepos(
  existing: string[], 
  requested: string[], 
  toRemove: string[], 
  mode: string
): string[] {
  const existingSet = new Set(existing);
  const requestedSet = new Set(requested);
  const toRemoveSet = new Set(toRemove);

  switch (mode) {
    case 'merge':
      return Array.from(new Set([...existing, ...requested])).sort();
    
    case 'remove':
      return existing.filter(repo => !requestedSet.has(repo)).sort();
    
    case 'mixed':
      // Start with existing, remove specified repos, then add new ones
      const afterRemoval = existing.filter(repo => !toRemoveSet.has(repo));
      return Array.from(new Set([...afterRemoval, ...requested])).sort();
    
    case 'replace':
    default:
      return requested.sort();
  }
}

// Show diff of changes
function showDiff(existing: string[], final: string[], requested: string[], mode: string) {
  const existingSet = new Set(existing);
  const finalSet = new Set(final);
  const requestedSet = new Set(requested);
  
  const added = final.filter(repo => !existingSet.has(repo));
  const removed = existing.filter(repo => !finalSet.has(repo));
  const unchanged = final.filter(repo => existingSet.has(repo));

  console.log(`\n📊 Operation: ${mode.toUpperCase()}`);
  console.log(`\n📝 Summary:`);
  console.log(`   Total repositories: ${existing.length} → ${final.length}`);
  
  if (added.length > 0) {
    console.log(`\n✨ Adding (${added.length}):`);
    added.forEach(repo => console.log(`   + ${repo}`));
  }
  
  if (removed.length > 0) {
    console.log(`\n🗑️  Removing (${removed.length}):`);
    removed.forEach(repo => console.log(`   - ${repo}`));
  }
  
  if (unchanged.length > 0) {
    console.log(`\n✓  Unchanged (${unchanged.length}):`);
    unchanged.forEach(repo => console.log(`     ${repo}`));
  }

  // Show which requested repos already exist (for merge/mixed modes)
  if ((mode === 'merge' || mode === 'mixed') && requestedSet.size > added.length) {
    const alreadyExists = requested.filter(repo => existingSet.has(repo));
    if (alreadyExists.length > 0) {
      console.log(`\nℹ️  Already exist (${alreadyExists.length}):`);
      alreadyExists.forEach(repo => console.log(`     ${repo}`));
    }
  }

  console.log(`\n📦 Final repository list (${final.length}):`);
  final.forEach(repo => console.log(`   • ${repo}`));
}

const app = new App();

class GithubActionsIamStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps & { createOidcProvider?: boolean; finalRepos: string[] }) {
    super(scope, id, props);

    const { finalRepos = [], createOidcProvider = false } = props || {};

    // Reference existing OIDC provider or create new one
    const accountId = Stack.of(this).account;
    const githubOidcProviderArn = `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;
    
    // Create OIDC provider only if it doesn't exist
    if (createOidcProvider) {
      console.log('\n🔐 Creating new OIDC Provider...');
      new CfnOIDCProvider(this, "GithubOidcProvider", {
        url: "https://token.actions.githubusercontent.com",
        clientIdList: ["sts.amazonaws.com"],
        thumbprintList: [
          "6938fd4d98bab03faadb97b34396831e3780aea1",
          "1c58a3a8518e8759bf075b76b750d4f2df264fcd"
        ]
      });
    }

    console.log(`\n👤 Creating/Updating IAM Role: ${roleName}...`);
    const deploymentRole = new Role(this, "GithubActionsRole", {
      roleName: roleName,
      assumedBy: new WebIdentityPrincipal(
        githubOidcProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": finalRepos.map(repo => `repo:${repo}:*`)
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

    new CfnOutput(this, "RoleName", {
      value: deploymentRole.roleName,
      description: "Name of the IAM role"
    });

    new CfnOutput(this, "PolicyName", {
      value: policyName,
      description: "AWS managed policy attached to the role"
    });

    new CfnOutput(this, "RepositoryCount", {
      value: finalRepos.length.toString(),
      description: "Number of repositories with access"
    });
  }
}

// Main execution
async function main() {
  // LIST MODE - Just show current repos and exit
  if (mode === 'list') {
    console.log(`📋 Stack: ${stackName}`);
    console.log(`👤 Role: ${roleName}\n`);
    
    const existingRepos = await getExistingRepos();
    
    if (existingRepos.length === 0) {
      console.log('ℹ️  No repositories found in trust policy (or role does not exist)\n');
      process.exit(0);
    }
    
    console.log(`\n✅ Current repositories in trust policy (${existingRepos.length}):\n`);
    existingRepos.forEach((repo, idx) => console.log(`   ${idx + 1}. ${repo}`));
    console.log('');
    process.exit(0);
  }
  
  // MODIFY MODE (merge/replace/remove/mixed)
  if (requestedRepos.length > 0) {
    console.log(`📋 Repositories to add (${requestedRepos.length}):`);
    requestedRepos.forEach(repo => console.log(`   + ${repo}`));
  }
  if (reposToRemove.length > 0) {
    console.log(`🗑️  Repositories to remove (${reposToRemove.length}):`);
    reposToRemove.forEach(repo => console.log(`   - ${repo}`));
  }
  console.log(`🔑 Policy: ${policyName}`);
  console.log(`🎯 Mode: ${mode}`);
  
  // Check for existing setup
  const existingRepos = await getExistingRepos();
  const oidcExists = await checkOidcProviderExists();
  
  // Calculate final repos list
  const finalRepos = calculateFinalRepos(existingRepos, requestedRepos, reposToRemove, mode);
  
  // Show diff
  showDiff(existingRepos, finalRepos, requestedRepos, mode);
  
  // Validation
  if (finalRepos.length === 0) {
    console.error('\n❌ Error: Final repository list is empty. Cannot proceed.');
    process.exit(1);
  }
  
  // Prompt for confirmation
  const confirmed = await promptConfirmation('\n❓ Do you want to proceed with these changes?');
  
  if (!confirmed) {
    console.log('\n❌ Operation cancelled by user');
    process.exit(0);
  }
  
  console.log('\n✅ Confirmed - proceeding with deployment...');
  
  // Create/update stack
  new GithubActionsIamStack(app, stackName, {
    createOidcProvider: !oidcExists,
    finalRepos: finalRepos
  });

  console.log('\n🔨 Synthesizing CloudFormation template...');
  const assembly = app.synth();

  // Execute the deployment
  console.log('\n🚀 Starting deployment...');
  try {
    const cdkCommand = [
      'cdk deploy',
      stackName,
      '--require-approval never',
      `--app "${assembly.directory}"`,
    ].join(' ');

    console.log(`\n💻 Executing: ${cdkCommand}\n`);
    
    execSync(cdkCommand, {
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_REGION: process.env.AWS_REGION || 'us-east-1',
      }
    });
    
    console.log('\n✅ Deployment completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Copy the Role ARN from the output above');
    console.log('   2. Add it as a secret named \'AWS_ROLE_ARN\' in each repository');
    console.log('   3. Verify the GitHub Actions workflows can assume the role\n');
  } catch (error) {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
}); 