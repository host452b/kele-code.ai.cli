// Content for the study-abc-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import csharpStudyAbcApi from './study-abc-api/csharp/study-abc-api.md'
import curlExamples from './study-abc-api/curl/examples.md'
import goStudyAbcApi from './study-abc-api/go/study-abc-api.md'
import javaStudyAbcApi from './study-abc-api/java/study-abc-api.md'
import phpStudyAbcApi from './study-abc-api/php/study-abc-api.md'
import pythonAgentSdkPatterns from './study-abc-api/python/agent-sdk/patterns.md'
import pythonAgentSdkReadme from './study-abc-api/python/agent-sdk/README.md'
import pythonStudyAbcApiBatches from './study-abc-api/python/study-abc-api/batches.md'
import pythonStudyAbcApiFilesApi from './study-abc-api/python/study-abc-api/files-api.md'
import pythonStudyAbcApiReadme from './study-abc-api/python/study-abc-api/README.md'
import pythonStudyAbcApiStreaming from './study-abc-api/python/study-abc-api/streaming.md'
import pythonStudyAbcApiToolUse from './study-abc-api/python/study-abc-api/tool-use.md'
import rubyStudyAbcApi from './study-abc-api/ruby/study-abc-api.md'
import skillPrompt from './study-abc-api/SKILL.md'
import sharedErrorCodes from './study-abc-api/shared/error-codes.md'
import sharedLiveSources from './study-abc-api/shared/live-sources.md'
import sharedModels from './study-abc-api/shared/models.md'
import sharedPromptCaching from './study-abc-api/shared/prompt-caching.md'
import sharedToolUseConcepts from './study-abc-api/shared/tool-use-concepts.md'
import typescriptAgentSdkPatterns from './study-abc-api/typescript/agent-sdk/patterns.md'
import typescriptAgentSdkReadme from './study-abc-api/typescript/agent-sdk/README.md'
import typescriptStudyAbcApiBatches from './study-abc-api/typescript/study-abc-api/batches.md'
import typescriptStudyAbcApiFilesApi from './study-abc-api/typescript/study-abc-api/files-api.md'
import typescriptStudyAbcApiReadme from './study-abc-api/typescript/study-abc-api/README.md'
import typescriptStudyAbcApiStreaming from './study-abc-api/typescript/study-abc-api/streaming.md'
import typescriptStudyAbcApiToolUse from './study-abc-api/typescript/study-abc-api/tool-use.md'

// @[MODEL LAUNCH]: Update the model IDs/names below. These are substituted into {{VAR}}
// placeholders in the .md files at runtime before the skill prompt is sent.
// After updating these constants, manually update the two files that still hardcode models:
//   - study-abc-api/SKILL.md (Current Models pricing table)
//   - study-abc-api/shared/models.md (full model catalog with legacy versions and alias mappings)
export const SKILL_MODEL_VARS = {
  OPUS_ID: 'ab-opus-4-6',
  OPUS_NAME: 'StudyAbc Opus 4.6',
  SONNET_ID: 'ab-sonnet-4-6',
  SONNET_NAME: 'StudyAbc Sonnet 4.6',
  HAIKU_ID: 'ab-haiku-4-5',
  HAIKU_NAME: 'StudyAbc Haiku 4.5',
  // Previous Sonnet ID — used in "do not append date suffixes" example in SKILL.md.
  PREV_SONNET_ID: 'ab-sonnet-4-5',
} satisfies Record<string, string>

export const SKILL_PROMPT: string = skillPrompt

export const SKILL_FILES: Record<string, string> = {
  'csharp/study-abc-api.md': csharpStudyAbcApi,
  'curl/examples.md': curlExamples,
  'go/study-abc-api.md': goStudyAbcApi,
  'java/study-abc-api.md': javaStudyAbcApi,
  'php/study-abc-api.md': phpStudyAbcApi,
  'python/agent-sdk/README.md': pythonAgentSdkReadme,
  'python/agent-sdk/patterns.md': pythonAgentSdkPatterns,
  'python/study-abc-api/README.md': pythonStudyAbcApiReadme,
  'python/study-abc-api/batches.md': pythonStudyAbcApiBatches,
  'python/study-abc-api/files-api.md': pythonStudyAbcApiFilesApi,
  'python/study-abc-api/streaming.md': pythonStudyAbcApiStreaming,
  'python/study-abc-api/tool-use.md': pythonStudyAbcApiToolUse,
  'ruby/study-abc-api.md': rubyStudyAbcApi,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/models.md': sharedModels,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/agent-sdk/README.md': typescriptAgentSdkReadme,
  'typescript/agent-sdk/patterns.md': typescriptAgentSdkPatterns,
  'typescript/study-abc-api/README.md': typescriptStudyAbcApiReadme,
  'typescript/study-abc-api/batches.md': typescriptStudyAbcApiBatches,
  'typescript/study-abc-api/files-api.md': typescriptStudyAbcApiFilesApi,
  'typescript/study-abc-api/streaming.md': typescriptStudyAbcApiStreaming,
  'typescript/study-abc-api/tool-use.md': typescriptStudyAbcApiToolUse,
}
