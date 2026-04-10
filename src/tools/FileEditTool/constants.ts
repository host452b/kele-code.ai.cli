// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .studyAbc/ folder
export const STUDY_ABC_FOLDER_PERMISSION_PATTERN = '/.studyAbc/**'

// Permission pattern for granting session-level access to the global ~/.studyAbc/ folder
export const GLOBAL_STUDY_ABC_FOLDER_PERMISSION_PATTERN = '~/.studyAbc/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
