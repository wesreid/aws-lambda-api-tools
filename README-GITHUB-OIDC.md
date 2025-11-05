# GitHub OIDC IAM Setup Tool

This tool creates and manages AWS IAM roles for GitHub Actions using OIDC (OpenID Connect) authentication. It provides intelligent repository management with merge, replace, and remove modes.

## Features

✨ **Intelligent Repository Management**
- Detects existing repositories in trust policy
- Merge mode: Add new repos without removing existing ones
- Replace mode: Overwrite entire repository list (default)
- Remove mode: Remove specific repositories
- Shows detailed diff before applying changes
- Interactive confirmation prompt (can be skipped with `--yes`)

🔐 **Automatic OIDC Provider Setup**
- Detects existing GitHub OIDC provider
- Creates provider if it doesn't exist
- Reuses existing provider to avoid conflicts

📊 **Clear Visual Feedback**
- Color-coded output with emojis
- Shows repos being added, removed, and unchanged
- Displays final repository list before deployment
- Confirms duplicate repos in merge mode

## Installation

```bash
npm install -g aws-lambda-api-tools
# or use with npx
npx aws-lambda-api-tools create-gha-iam-stack [options]
```

## Basic Usage

### Create New Setup (Replace Mode - Default)

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/repo1 \
  --repo=myorg/repo2 \
  --repo=myorg/repo3 \
  --policy=AdministratorAccess
```

### Add New Repositories (Merge Mode)

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/new-repo1 \
  --repo=myorg/new-repo2 \
  --mode=merge \
  --policy=AdministratorAccess
```

**Example Output:**
```
📋 Requested repositories (2):
   - myorg/new-repo1
   - myorg/new-repo2
🔑 Policy: AdministratorAccess
🎯 Mode: merge

✅ Found existing IAM role: GithubActionsRole
📋 Current repositories (3):
   - myorg/repo1
   - myorg/repo2
   - myorg/repo3

📊 Operation: MERGE

📝 Summary:
   Total repositories: 3 → 5

✨ Adding (2):
   + myorg/new-repo1
   + myorg/new-repo2

✓  Unchanged (3):
     myorg/repo1
     myorg/repo2
     myorg/repo3

📦 Final repository list (5):
   • myorg/new-repo1
   • myorg/new-repo2
   • myorg/repo1
   • myorg/repo2
   • myorg/repo3

❓ Do you want to proceed with these changes? (y/n):
```

### Remove Repositories

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/old-repo \
  --mode=remove \
  --policy=AdministratorAccess
```

**Example Output:**
```
📊 Operation: REMOVE

📝 Summary:
   Total repositories: 5 → 4

🗑️  Removing (1):
   - myorg/old-repo

✓  Unchanged (4):
     myorg/repo1
     myorg/repo2
     myorg/repo3
     myorg/new-repo1

📦 Final repository list (4):
   • myorg/repo1
   • myorg/repo2
   • myorg/repo3
   • myorg/new-repo1
```

### Replace All Repositories

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/production-app \
  --repo=myorg/staging-app \
  --mode=replace \
  --policy=PowerUserAccess
```

## CLI Options

| Option | Description | Default | Required |
|--------|-------------|---------|----------|
| `--repo <owner/repo>` | GitHub repository to add (can specify multiple) | - | See notes |
| `--remove-repo <owner/repo>` | GitHub repository to remove (can specify multiple) | - | See notes |
| `--policy <name>` | AWS managed policy name | `AdministratorAccess` | No |
| `--mode <mode>` | Operation mode: `merge`, `replace`, `list` | `replace` | No |
| `--yes` | Skip confirmation prompt | `false` | No |
| `--stack-name <name>` | CloudFormation stack name | `GithubActionsIam` | No |
| `--role-name <name>` | IAM role name | `GithubActionsRole` | No |

**Note on --repo and --remove-repo:**
- At least one `--repo` or `--remove-repo` is required (except for `--mode=list`)
- You can mix both flags in a single command to add and remove repos simultaneously
- Using `--remove-repo` automatically sets mode to `remove` or `mixed`

## Operation Modes

### 🔄 Replace Mode (Default)

Overwrites the entire repository list with the repos you specify.

**Use when:**
- Setting up for the first time
- Doing a complete reconfiguration
- Removing multiple repos and adding new ones

```bash
# Before: repo1, repo2, repo3
# Command: --repo=repo4 --repo=repo5 --mode=replace
# After: repo4, repo5
```

### 🔀 Merge Mode

Adds new repositories to the existing list without removing any.

**Use when:**
- Adding access for new repositories
- Expanding your CI/CD to new projects
- Granting access incrementally

```bash
# Before: repo1, repo2
# Command: --repo=repo3 --repo=repo4 --mode=merge
# After: repo1, repo2, repo3, repo4
```

**Smart Duplicate Detection:**
If you specify repos that already exist, the tool will:
1. Show which repos already exist
2. Only add the new ones
3. Display a summary of duplicates

### 🗑️ Remove Mode

Removes specified repositories from the existing list.

**Use when:**
- Revoking access for archived projects
- Removing deprecated repositories
- Tightening security by reducing access

```bash
# Before: repo1, repo2, repo3
# Command: --remove-repo=repo2
# After: repo1, repo3
```

### 🔀 Mixed Mode (Automatic)

Add and remove repositories in a single command. Mode is automatically set to `mixed` when you use both `--repo` and `--remove-repo` flags.

**Use when:**
- Swapping out old repos for new ones
- Reorganizing repository access
- Migrating from old to new repository names

```bash
# Before: old-api, old-frontend, shared-lib
# Command: --repo=new-api --repo=new-frontend --remove-repo=old-api --remove-repo=old-frontend
# After: new-api, new-frontend, shared-lib
```

**Example output:**
```
📋 Repositories to add (2):
   + myorg/new-api
   + myorg/new-frontend
🗑️  Repositories to remove (2):
   - myorg/old-api
   - myorg/old-frontend

📊 Operation: MIXED

📝 Summary:
   Total repositories: 3 → 3

✨ Adding (2):
   + myorg/new-api
   + myorg/new-frontend

🗑️  Removing (2):
   - myorg/old-api
   - myorg/old-frontend

✓  Unchanged (1):
     myorg/shared-lib
```

### 📋 List Mode

View current repositories without making any changes. Read-only operation.

**Use when:**
- Checking current configuration
- Auditing repository access
- Verifying setup

```bash
npx aws-lambda-api-tools create-gha-iam-stack --mode=list
```

**Example output:**
```
📋 Stack: GithubActionsIam
👤 Role: GithubActionsRole

✅ Found existing IAM role: GithubActionsRole
📋 Current repositories (5):
   - myorg/api
   - myorg/backend
   - myorg/frontend
   - myorg/infra
   - myorg/shared-lib

✅ Current repositories in trust policy (5):

   1. myorg/api
   2. myorg/backend
   3. myorg/frontend
   4. myorg/infra
   5. myorg/shared-lib
```

## Common Workflows

### Initial Setup for New Organization

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/api \
  --repo=myorg/frontend \
  --repo=myorg/backend \
  --policy=AdministratorAccess \
  --yes
```

### Add New Microservice

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/new-microservice \
  --mode=merge \
  --policy=AdministratorAccess
```

### Archive Old Projects

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --remove-repo=myorg/legacy-app-1 \
  --remove-repo=myorg/legacy-app-2 \
  --yes
```

### Swap Repositories (Add New, Remove Old)

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/new-api-v2 \
  --repo=myorg/new-frontend-v2 \
  --remove-repo=myorg/old-api \
  --remove-repo=myorg/old-frontend \
  --policy=AdministratorAccess
```

### List Current Access

```bash
npx aws-lambda-api-tools create-gha-iam-stack --mode=list
```

### Automated CI/CD Scripts

```bash
#!/bin/bash
# add-repo-to-oidc.sh

REPO_NAME=$1
MODE=${2:-merge}

npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=$REPO_NAME \
  --mode=$MODE \
  --policy=AdministratorAccess \
  --yes
```

## Advanced Configuration

### Custom IAM Policy

Instead of `AdministratorAccess`, you can use more restrictive policies:

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/readonly-app \
  --policy=ReadOnlyAccess \
  --mode=merge
```

Common AWS managed policies:
- `AdministratorAccess` - Full access (use cautiously!)
- `PowerUserAccess` - Full access except IAM
- `ReadOnlyAccess` - Read-only access to all services
- `AmazonS3FullAccess` - S3 only
- `AWSLambdaFullAccess` - Lambda only

### Custom Stack and Role Names

```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/app \
  --stack-name=MyCustomStack \
  --role-name=MyGitHubActionsRole \
  --mode=merge
```

### Multiple AWS Accounts

For multi-account setups, use different AWS profiles:

```bash
# Development account
AWS_PROFILE=dev npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/app \
  --policy=PowerUserAccess

# Production account
AWS_PROFILE=prod npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/app \
  --policy=PowerUserAccess
```

## Troubleshooting

### "No existing IAM role found"

This is normal for first-time setup. The tool will create a new role.

### "Already exist" warnings in merge mode

This is informational. The tool detected duplicates and is only adding new repos.

### "Final repository list is empty"

You tried to remove all repos or made a mistake in remove mode. The tool prevents creating an empty trust policy.

### IAM Permission Errors

Ensure your AWS credentials have permissions to:
- `iam:GetRole`
- `iam:CreateRole`
- `iam:UpdateRole`
- `iam:UpdateAssumeRolePolicy`
- `iam:CreateOpenIDConnectProvider`
- `iam:ListOpenIDConnectProviders`

## Security Best Practices

1. **Principle of Least Privilege**: Use the most restrictive policy that works for your use case
2. **Regular Audits**: Periodically review the repository list and remove unused repos
3. **Separate Accounts**: Use different AWS accounts for dev/staging/prod
4. **Monitor Usage**: Enable CloudTrail to monitor role assumption
5. **Restrict by Branch**: Consider restricting the trust policy to specific branches:

   ```bash
   # This requires custom policy - not yet supported by this tool
   # "token.actions.githubusercontent.com:sub": "repo:myorg/myrepo:ref:refs/heads/main"
   ```

## Integration with GitHub Actions

After running this tool, add the Role ARN to your GitHub repository secrets:

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1
      
      - name: Deploy
        run: |
          # Your deployment commands here
          aws s3 ls
```

## FAQ

**Q: Can I use wildcards in repository names?**  
A: No, you must specify exact repository names. The tool already adds `:*` for branch wildcards.

**Q: How many repositories can I add?**  
A: AWS has a limit on trust policy size (~2048 characters). Roughly 50-100 repos depending on org/repo name lengths.

**Q: Does this work with GitHub Enterprise?**  
A: Currently only github.com is supported. Enterprise Server support could be added.

**Q: Can I see what's currently configured without making changes?**  
A: Yes! Just run with a fake repo and cancel at the confirmation:
```bash
npx aws-lambda-api-tools create-gha-iam-stack --repo=fake/test --mode=merge
# View output, then answer 'n' at confirmation prompt
```

## Contributing

Found a bug or have a feature request? Open an issue or PR at:
https://github.com/wesreid/aws-lambda-api-tools

## License

UNLICENSED - Private use only

