# Requirements Document

## Introduction

This feature adds persistent conversation history management to the CloudOps Agent frontend. Users can create, browse, rename, delete, and switch between conversations. All conversation data persists in DynamoDB and is scoped per user via Cognito authentication. The frontend communicates with DynamoDB through an API Gateway (Cognito authorizer) backed by Lambda functions. The agent continues using AgentCore Memory via sessionId for its context — this feature manages the UI-level conversation list and message storage independently.

## Glossary

- **Frontend**: The React single-page application deployed on AWS Amplify Hosting that provides the CloudOps Agent chat interface
- **Conversation_API**: The Amazon API Gateway REST API with Cognito authorizer that exposes CRUD endpoints for conversation management
- **Conversation_Service**: The frontend TypeScript service module responsible for making HTTP requests to the Conversation_API
- **Conversation_Lambda**: The AWS Lambda function that handles CRUD operations on conversation records in DynamoDB
- **Conversations_Table**: The DynamoDB table storing conversation records with userId as partition key and conversationId as sort key
- **Sidebar**: The left-panel navigation component in the Frontend that displays the list of past conversations
- **Conversation**: A record consisting of a unique conversationId, a display name, an ordered list of messages, and creation/update timestamps
- **Message**: A single chat exchange entry containing a role (user or assistant), text content, and a timestamp
- **Authenticated_User**: A user who has signed in via AWS Amplify Auth (Cognito) and possesses a valid access token
- **SessionId**: A unique identifier used both as the conversationId in the Conversations_Table and as the sessionId passed to the AgentCore runtime for memory continuity

## Requirements

### Requirement 1: List Conversations

**User Story:** As an Authenticated_User, I want to see my past conversations listed in the Sidebar, so that I can quickly find and resume previous interactions with the agent.

#### Acceptance Criteria

1. WHEN the Frontend loads after authentication, THE Conversation_Service SHALL retrieve all Conversation records for the Authenticated_User from the Conversation_API
2. THE Sidebar SHALL display retrieved Conversation records sorted by updatedAt timestamp in descending order (most recent first)
3. THE Sidebar SHALL display the conversationName for each Conversation record
4. WHILE the Conversation_Service is fetching Conversation records, THE Sidebar SHALL display a loading indicator
5. IF the Conversation_Service fails to retrieve Conversation records, THEN THE Sidebar SHALL display an error message with a retry option

### Requirement 2: Create New Conversation

**User Story:** As an Authenticated_User, I want to start a new conversation, so that I can ask the agent questions on a fresh topic without mixing context with previous conversations.

#### Acceptance Criteria

1. THE Sidebar SHALL display a "New Conversation" button that is accessible via keyboard and screen reader
2. WHEN the Authenticated_User activates the "New Conversation" button, THE Conversation_Service SHALL send a POST request to the Conversation_API to create a new Conversation record
3. WHEN the Conversation_API successfully creates a new Conversation record, THE Frontend SHALL generate a unique SessionId and associate it with the new Conversation as the conversationId
4. WHEN a new Conversation is created, THE Sidebar SHALL prepend the new Conversation to the top of the conversation list
5. WHEN a new Conversation is created, THE Frontend SHALL clear the message display area and set the new Conversation as the active conversation
6. IF the Conversation_Service fails to create a new Conversation, THEN THE Frontend SHALL display an error notification to the Authenticated_User

### Requirement 3: Switch Between Conversations

**User Story:** As an Authenticated_User, I want to click on a past conversation to load its messages, so that I can continue where I left off or review previous agent responses.

#### Acceptance Criteria

1. WHEN the Authenticated_User selects a Conversation from the Sidebar, THE Conversation_Service SHALL retrieve the full Conversation record including all Message entries from the Conversation_API
2. WHEN the Conversation_Service successfully retrieves a Conversation record, THE Frontend SHALL display the Message entries in the message display area in chronological order
3. WHEN the Authenticated_User switches to a different Conversation, THE Frontend SHALL update the active SessionId to the selected Conversation's conversationId
4. WHILE the Conversation_Service is loading a Conversation's Message entries, THE Frontend SHALL display a loading indicator in the message display area
5. IF the Conversation_Service fails to retrieve a Conversation record, THEN THE Frontend SHALL display an error message with a retry option
6. THE Sidebar SHALL visually highlight the currently active Conversation

### Requirement 4: Rename Conversation

**User Story:** As an Authenticated_User, I want to rename a conversation, so that I can give it a meaningful title that helps me identify its content later.

#### Acceptance Criteria

1. THE Sidebar SHALL provide a rename action for each Conversation record that is accessible via keyboard and screen reader
2. WHEN the Authenticated_User initiates a rename action, THE Sidebar SHALL display an editable text field pre-populated with the current conversationName
3. WHEN the Authenticated_User submits a new name, THE Conversation_Service SHALL send a PUT request to the Conversation_API to update the conversationName
4. WHEN the Conversation_API successfully updates the conversationName, THE Sidebar SHALL display the updated name in the conversation list
5. IF the Authenticated_User submits an empty name, THEN THE Frontend SHALL retain the previous conversationName and cancel the rename operation
6. IF the Conversation_Service fails to update the conversationName, THEN THE Frontend SHALL revert the displayed name to the previous value and display an error notification

### Requirement 5: Delete Conversation

**User Story:** As an Authenticated_User, I want to delete a conversation I no longer need, so that my conversation list stays organized and manageable.

#### Acceptance Criteria

1. THE Sidebar SHALL provide a delete action for each Conversation record that is accessible via keyboard and screen reader
2. WHEN the Authenticated_User initiates a delete action, THE Frontend SHALL display a confirmation prompt before proceeding
3. WHEN the Authenticated_User confirms deletion, THE Conversation_Service SHALL send a DELETE request to the Conversation_API to remove the Conversation record
4. WHEN the Conversation_API successfully deletes a Conversation record, THE Sidebar SHALL remove the Conversation from the displayed list
5. WHEN the currently active Conversation is deleted, THE Frontend SHALL create a new Conversation and set it as active
6. IF the Conversation_Service fails to delete a Conversation record, THEN THE Frontend SHALL display an error notification and retain the Conversation in the list

### Requirement 6: Auto-Save Messages

**User Story:** As an Authenticated_User, I want my messages to be saved automatically as the conversation progresses, so that I do not lose context if I close the browser or navigate away.

#### Acceptance Criteria

1. WHEN the Authenticated_User sends a Message, THE Conversation_Service SHALL send a PUT request to the Conversation_API to append the user Message to the Conversation record
2. WHEN the agent responds with a Message, THE Conversation_Service SHALL send a PUT request to the Conversation_API to append the assistant Message to the Conversation record
3. WHEN a Message is appended to a Conversation record, THE Conversation_Lambda SHALL update the updatedAt timestamp on the Conversation record
4. IF the Conversation_Service fails to save a Message, THEN THE Frontend SHALL retry the save operation once after a 2-second delay
5. IF the retry also fails, THEN THE Frontend SHALL display a non-blocking warning indicator that the Message was not persisted

### Requirement 7: Persistence Across Sessions

**User Story:** As an Authenticated_User, I want my conversations to be available after I log out and log back in, so that I can always access my full history regardless of device or browser session.

#### Acceptance Criteria

1. THE Conversation_Lambda SHALL store all Conversation records in the Conversations_Table using the Authenticated_User's Cognito userId as the partition key
2. THE Conversation_Lambda SHALL store the conversationId as the sort key in the Conversations_Table
3. THE Conversations_Table SHALL store each Conversation record with the following attributes: userId, conversationId, conversationName, messages (list of Message objects), createdAt (ISO 8601 timestamp), and updatedAt (ISO 8601 timestamp)
4. WHEN the Authenticated_User signs in, THE Frontend SHALL retrieve and display Conversation records from the Conversations_Table via the Conversation_API
5. THE Frontend SHALL NOT rely on browser sessionStorage or localStorage for conversation persistence

### Requirement 8: Multi-User Isolation

**User Story:** As an Authenticated_User, I want to be certain that only I can see my conversations, so that sensitive operational queries and agent responses remain private.

#### Acceptance Criteria

1. THE Conversation_API SHALL use Amazon Cognito as the authorizer and extract the userId from the authenticated token
2. THE Conversation_Lambda SHALL filter all read operations to return only Conversation records where the partition key matches the requesting Authenticated_User's userId
3. THE Conversation_Lambda SHALL reject any write or delete operation where the target Conversation record's userId does not match the requesting Authenticated_User's userId
4. IF an Authenticated_User attempts to access a Conversation that does not belong to them, THEN THE Conversation_API SHALL return a 403 Forbidden response

### Requirement 9: Default Conversation Naming

**User Story:** As an Authenticated_User, I want new conversations to have a meaningful default name, so that I can identify them in the sidebar without having to rename each one manually.

#### Acceptance Criteria

1. WHEN a new Conversation is created and the first user Message is sent, THE Conversation_Lambda SHALL set the conversationName to the first 50 characters of the first user Message content
2. WHEN a new Conversation is created before any Message is sent, THE Conversation_Lambda SHALL set the conversationName to "New Conversation" followed by the creation date in YYYY-MM-DD format
3. THE Conversation_Lambda SHALL truncate the auto-generated conversationName at 50 characters and append an ellipsis if the source text exceeds 50 characters

### Requirement 10: API Endpoint Structure

**User Story:** As a developer, I want a well-defined REST API for conversation management, so that the frontend can reliably perform CRUD operations on conversation data.

#### Acceptance Criteria

1. THE Conversation_API SHALL expose a GET /conversations endpoint that returns all Conversation records for the Authenticated_User (without Message arrays for performance)
2. THE Conversation_API SHALL expose a POST /conversations endpoint that creates a new Conversation record and returns the created record with its conversationId
3. THE Conversation_API SHALL expose a GET /conversations/{conversationId} endpoint that returns a single Conversation record including its full Message array
4. THE Conversation_API SHALL expose a PUT /conversations/{conversationId} endpoint that accepts updates to conversationName and appended Message entries
5. THE Conversation_API SHALL expose a DELETE /conversations/{conversationId} endpoint that removes the Conversation record from the Conversations_Table
6. THE Conversation_API SHALL validate that the {conversationId} path parameter matches UUID format before processing the request
7. IF the Conversation_API receives a request for a non-existent conversationId, THEN THE Conversation_API SHALL return a 404 Not Found response
