export const PR_TITLE = 'Add Study Abc GitHub Workflow'

export const GITHUB_ACTION_SETUP_DOCS_URL =
  'https://github.com/acompanys/study-abc-action/blob/main/docs/setup.md'

export const WORKFLOW_CONTENT = `name: Study Abc

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  studyAbc:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@studyAbc')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@studyAbc')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@studyAbc')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@studyAbc') || contains(github.event.issue.title, '@studyAbc')))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
      actions: read # Required for StudyAbc to read CI results on PRs
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Study Abc
        id: studyAbc
        uses: acompanys/study-abc-action@v1
        with:
          acompany_api_key: \${{ secrets.ACOMPANY_API_KEY }}

          # This is an optional setting that allows StudyAbc to read CI results on PRs
          additional_permissions: |
            actions: read

          # Optional: Give a custom prompt to StudyAbc. If this is not specified, StudyAbc will perform the instructions specified in the comment that tagged it.
          # prompt: 'Update the pull request description to include a summary of changes.'

          # Optional: Add studyAbc_args to customize behavior and configuration
          # See https://github.com/acompanys/study-abc-action/blob/main/docs/usage.md
          # or https://code.studyAbc.com/docs/en/cli-reference for available options
          # studyAbc_args: '--allowed-tools Bash(gh pr:*)'

`

export const PR_BODY = `## 🤖 Installing Study Abc GitHub App

This PR adds a GitHub Actions workflow that enables Study Abc integration in our repository.

### What is Study Abc?

[Study Abc](https://studyAbc.com/study-abc) is an AI coding agent that can help with:
- Bug fixes and improvements  
- Documentation updates
- Implementing new features
- Code reviews and suggestions
- Writing tests
- And more!

### How it works

Once this PR is merged, we'll be able to interact with StudyAbc by mentioning @studyAbc in a pull request or issue comment.
Once the workflow is triggered, StudyAbc will analyze the comment and surrounding context, and execute on the request in a GitHub action.

### Important Notes

- **This workflow won't take effect until this PR is merged**
- **@studyAbc mentions won't work until after the merge is complete**
- The workflow runs automatically whenever StudyAbc is mentioned in PR or issue comments
- StudyAbc gets access to the entire PR or issue context including files, diffs, and previous comments

### Security

- Our Acompany API key is securely stored as a GitHub Actions secret
- Only users with write access to the repository can trigger the workflow
- All StudyAbc runs are stored in the GitHub Actions run history
- StudyAbc's default tools are limited to reading/writing files and interacting with our repo by creating comments, branches, and commits.
- We can add more allowed tools by adding them to the workflow file like:

\`\`\`
allowed_tools: Bash(npm install),Bash(npm run build),Bash(npm run lint),Bash(npm run test)
\`\`\`

There's more information in the [Study Abc action repo](https://github.com/acompanys/study-abc-action).

After merging this PR, let's try mentioning @studyAbc in a comment on any PR to get started!`

export const CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT = `name: Study Abc Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]
    # Optional: Only run on specific file changes
    # paths:
    #   - "src/**/*.ts"
    #   - "src/**/*.tsx"
    #   - "src/**/*.js"
    #   - "src/**/*.jsx"

jobs:
  studyAbc-review:
    # Optional: Filter by PR author
    # if: |
    #   github.event.pull_request.user.login == 'external-contributor' ||
    #   github.event.pull_request.user.login == 'new-developer' ||
    #   github.event.pull_request.author_association == 'FIRST_TIME_CONTRIBUTOR'

    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Study Abc Review
        id: studyAbc-review
        uses: acompanys/study-abc-action@v1
        with:
          acompany_api_key: \${{ secrets.ACOMPANY_API_KEY }}
          plugin_marketplaces: 'https://github.com/acompanys/study-abc.git'
          plugins: 'code-review@study-abc-plugins'
          prompt: '/code-review:code-review \${{ github.repository }}/pull/\${{ github.event.pull_request.number }}'
          # See https://github.com/acompanys/study-abc-action/blob/main/docs/usage.md
          # or https://code.studyAbc.com/docs/en/cli-reference for available options

`
