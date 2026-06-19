# Implementation Plan: Conversation History

## Overview

This plan implements persistent conversation history for the CloudOps Agent, covering backend infrastructure (CDK stack with DynamoDB, Lambda, API Gateway), Python Lambda CRUD handler, and frontend integration (service layer, state management, Sidebar upgrade, ChatContext integration). The CDK stack references the existing Cognito User Pool from AuthStack via cross-stack props (same pattern used by AgentRuntimeStack and MCPRuntimeStack).

## Tasks

- [x] 1. CDK Infrastructure — ConversationHistoryStack
  - [x] 1.1 Create `cdk/lib/conversation-history-stack.ts` with DynamoDB table and Lambda function
    - Define `ConversationHistoryStackProps` extending `StackProps` with `userPoolArn: string` and `userPoolId: string`
    - Create DynamoDB table `CloudOpsConversationsTable` with `userId` (partition key, String) and `conversationId` (sort key, String), PAY_PER_REQUEST billing, DESTROY removal policy
    - Create Lambda function `ConversationHandler` with Python 3.12 runtime, 256MB memory, 30s timeout, code from `cdk/lambda/conversations/`
    - Pass DynamoDB table name as environment variable `TABLE_NAME` to Lambda
    - Grant Lambda read/write access to the DynamoDB table
    - Add CDK-Nag suppressions as needed (similar to other stacks)
    - _Requirements: 7.1, 7.2, 7.3, 10.1–10.5_

  - [x] 1.2 Add API Gateway REST API with Cognito authorizer to `conversation-history-stack.ts`
    - Create REST API `ConversationApi` with CORS enabled (allow-origin `*`, allow-methods GET/POST/PUT/DELETE/OPTIONS)
    - Create Cognito authorizer using `userPoolArn` from props
    - Add resource `/conversations` with GET and POST methods (Lambda integration, Cognito auth)
    - Add resource `/conversations/{conversationId}` with GET, PUT, and DELETE methods (Lambda integration, Cognito auth)
    - Export API endpoint URL as CfnOutput `ConversationApiUrl`
    - Add CDK-Nag suppressions for API Gateway logging and authorization
    - _Requirements: 8.1, 10.1–10.7_

  - [x] 1.3 Register `ConversationHistoryStack` in `cdk/bin/app.ts`
    - Import `ConversationHistoryStack` from `../lib/conversation-history-stack`
    - Instantiate after `authStack` with props `userPoolArn: authStack.userPoolArn`, `userPoolId: authStack.userPoolId`
    - Add dependency on `authStack`
    - _Requirements: 8.1_

- [x] 2. Lambda Handler — Python CRUD Implementation
  - [x] 2.1 Create `cdk/lambda/conversations/handler.py` with routing and list/create operations
    - Implement `handler(event, context)` entry point that routes by `httpMethod` + `resource`
    - Extract `user_id` from `event['requestContext']['authorizer']['claims']['sub']`
    - Implement `list_conversations(user_id)` — query DDB by userId, return metadata without messages array, sorted by updatedAt desc
    - Implement `create_conversation(user_id, body)` — generate UUID v4 conversationId, set default name as "New Conversation YYYY-MM-DD", store record with empty messages list, return 201
    - Return proper CORS headers on all responses
    - _Requirements: 7.1, 7.2, 7.3, 8.2, 9.2, 10.1, 10.2_

  - [x] 2.2 Add get, update, and delete operations to `handler.py`
    - Implement `get_conversation(user_id, conv_id)` — get item, verify userId matches, return full record with messages, return 404 if not found
    - Implement `update_conversation(user_id, conv_id, body)` — support updating `conversationName` and appending messages, update `updatedAt` timestamp, implement auto-naming (first 50 chars of first user message + ellipsis if truncated)
    - Implement `delete_conversation(user_id, conv_id)` — verify ownership, delete item, return 204
    - Return 403 if userId mismatch on any write/read operation
    - _Requirements: 8.2, 8.3, 8.4, 9.1, 9.3, 10.3, 10.4, 10.5_

  - [x] 2.3 Add input validation to `handler.py`
    - Validate `{conversationId}` path parameter matches UUID v4 format regex, return 400 if invalid
    - Validate `conversationName` is not empty/whitespace-only on rename, return 400 if invalid
    - Return 404 for valid UUID that doesn't exist in table for the requesting user
    - _Requirements: 4.5, 10.6, 10.7_

  - [ ]\* 2.4 Write unit tests for Lambda handler (`cdk/lambda/conversations/test_handler.py`)
    - Test route dispatch for all HTTP method + path combinations
    - Test UUID validation (valid, invalid, missing)
    - Test empty name rejection
    - Test auto-naming logic (under 50 chars, over 50 chars, exactly 50 chars)
    - Test user isolation (403 on cross-user access)
    - Mock boto3 DynamoDB resource
    - _Requirements: 8.2, 8.3, 9.1, 9.3, 10.6, 10.7_

  - [ ]\* 2.5 Write property tests for Lambda handler (`cdk/lambda/conversations/test_properties.py`)
    - **Property 9: Stored conversation records have complete schema**
    - **Property 10: User isolation — cross-user access is forbidden**
    - **Property 11: Auto-generated conversation name with truncation**
    - **Property 12: UUID format validation on path parameters**
    - **Property 13: Non-existent conversation returns 404**
    - **Validates: Requirements 7.1, 7.2, 7.3, 8.2, 8.3, 8.4, 9.1, 9.3, 10.6, 10.7**
    - Use Hypothesis library with minimum 100 iterations per property

- [x] 3. Checkpoint — Backend verification
  - Ensure CDK synth completes without errors, Lambda tests pass, ask the user if questions arise.

- [x] 4. Frontend Service Layer
  - [x] 4.1 Create `frontend/src/services/conversationService.ts`
    - Implement `listConversations(token)` — GET /conversations with Authorization header
    - Implement `createConversation(token, body?)` — POST /conversations
    - Implement `getConversation(token, conversationId)` — GET /conversations/{id}
    - Implement `updateConversation(token, conversationId, body)` — PUT /conversations/{id}
    - Implement `deleteConversation(token, conversationId)` — DELETE /conversations/{id}
    - Read API base URL from `appConfig.conversationApi.endpoint` in localStorage
    - Handle HTTP error responses and throw typed errors
    - _Requirements: 1.1, 2.2, 3.1, 4.3, 5.3, 6.1, 6.2, 10.1–10.5_

  - [x] 4.2 Add `conversationApi` configuration to `frontend/src/types/index.ts` and config service
    - Extend `AppConfig` interface with `conversationApi?: { endpoint: string }`
    - Add helper function `getConversationApiEndpoint()` in config service
    - _Requirements: 7.5_

- [x] 5. Frontend State Management — ConversationContext
  - [x] 5.1 Create `frontend/src/state/ConversationContext.tsx`
    - Define `ConversationState` interface with conversations list, activeConversationId, loading/error states
    - Implement reducer with actions: SET_CONVERSATIONS, SET_ACTIVE, ADD_CONVERSATION, REMOVE_CONVERSATION, RENAME_CONVERSATION, SET_LOADING_LIST, SET_LOADING_CONVERSATION, SET_LIST_ERROR, SET_CONVERSATION_ERROR
    - Implement `ConversationProvider` component with context methods: loadConversations, createConversation, switchConversation, renameConversation, deleteConversation, saveMessages
    - Implement auto-save with single retry after 2-second delay on failure
    - Get auth token from Amplify Auth (fetchAuthSession) for API calls
    - _Requirements: 1.1, 1.4, 1.5, 2.2, 2.4, 2.6, 3.1, 3.4, 3.5, 4.3, 4.6, 5.3, 5.6, 6.1, 6.2, 6.4, 6.5_

  - [x] 5.2 Integrate `ConversationProvider` into the app component tree
    - Wrap app with `ConversationProvider` (inside AuthProvider, above ChatProvider)
    - Pass `activeConversationId` as `sessionId` to ChatContext
    - _Requirements: 3.3_

- [x] 6. Frontend UI — Sidebar Upgrade
  - [x] 6.1 Update `frontend/src/components/Sidebar/Sidebar.tsx` with conversation list UI
    - Add "New Conversation" button at top with keyboard/screen-reader accessibility
    - Render conversation list sorted by updatedAt (descending) from ConversationContext
    - Show loading skeleton while fetching conversations
    - Show error state with retry button on fetch failure
    - Highlight the currently active conversation
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 3.6_

  - [x] 6.2 Add rename and delete actions to Sidebar conversation items
    - Add rename action (inline editable text field, pre-populated with current name)
    - Reject empty/whitespace-only name submissions (keep previous name)
    - Add delete action with confirmation modal/prompt before proceeding
    - Show error toast notifications on failed rename/delete
    - Ensure all actions are keyboard and screen-reader accessible
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 5.1, 5.2, 5.4, 5.5, 5.6_

  - [x] 6.3 Update `frontend/src/components/Sidebar/Sidebar.module.css` with styles
    - Style conversation list items (hover, active highlight, truncated name)
    - Style "New Conversation" button
    - Style inline rename input field
    - Style loading skeleton and error states
    - Style delete confirmation prompt
    - _Requirements: 1.2, 3.6_

- [x] 7. Frontend Integration — ChatContext and Auto-Save
  - [x] 7.1 Modify `frontend/src/state/ChatContext.tsx` to support conversation switching
    - Add `setSessionId` and `setMessages` methods to ChatContextValue
    - Accept pre-loaded messages from ConversationContext when switching conversations
    - Update `sessionIdRef` when ConversationContext switches active conversation
    - Clear messages and set new sessionId on new conversation creation
    - _Requirements: 2.5, 3.2, 3.3_

  - [x] 7.2 Wire auto-save from ChatContext to ConversationContext
    - After each successful `sendMessage` (both user message and agent response), call `saveMessages` on ConversationContext
    - Implement save retry: 1 retry after 2-second delay on failure
    - Show non-blocking warning indicator if retry also fails
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.3 Update `frontend/src/types/index.ts` with conversation-related types
    - Add `ConversationMetadata` interface (conversationId, conversationName, createdAt, updatedAt)
    - Add `ConversationFull` interface extending ConversationMetadata with messages array
    - Update `SidebarProps` to include conversation context dependencies
    - _Requirements: 7.3_

- [x] 8. Checkpoint — Frontend verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ]\* 9. Frontend Property-Based Tests
  - [ ]\* 9.1 Write property tests for conversation list sorting and completeness
    - **Property 1: Conversation list is sorted and complete**
    - **Validates: Requirements 1.2, 1.3**
    - Use fast-check with minimum 100 iterations

  - [ ]\* 9.2 Write property tests for UUID generation and message ordering
    - **Property 2: Generated conversation IDs are unique**
    - **Property 3: Messages displayed in chronological order**
    - **Validates: Requirements 2.3, 3.2**
    - Use fast-check with minimum 100 iterations

  - [ ]\* 9.3 Write property tests for rename and delete operations
    - **Property 5: Successful rename updates displayed name**
    - **Property 6: Empty or whitespace-only names are rejected**
    - **Property 7: Deletion removes conversation from list**
    - **Validates: Requirements 4.4, 4.5, 5.4**
    - Use fast-check with minimum 100 iterations

  - [ ]\* 9.4 Write property tests for auto-save and sessionId
    - **Property 4: SessionId equals active conversationId**
    - **Property 8: Auto-save appends messages and updates timestamp**
    - **Validates: Requirements 3.3, 6.1, 6.2, 6.3**
    - Use fast-check with minimum 100 iterations

- [x] 10. Final Checkpoint — Full integration verification
  - Ensure CDK synth succeeds, all Lambda tests pass, all frontend tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The CDK stack follows the same cross-stack prop pattern used by `AgentRuntimeStack` (receives `userPoolArn` and `userPoolId` from `authStack`)
- The Lambda uses Python 3.12 (matching the agent runtime pattern)
- The frontend API endpoint is stored in `appConfig.conversationApi.endpoint` in localStorage (same pattern as existing config)
- Property tests validate universal correctness properties from the design document
- Frontend uses TypeScript + React; Lambda uses Python with boto3
- The `conversationId` doubles as `sessionId` for AgentCore memory continuity

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.2", "7.3"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["1.3", "2.3", "4.1"] },
    { "id": 3, "tasks": ["2.4", "2.5", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 6, "tasks": ["7.2"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4"] }
  ]
}
```
