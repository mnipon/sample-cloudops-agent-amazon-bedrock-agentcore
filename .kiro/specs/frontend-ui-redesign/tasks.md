# Implementation Plan: Frontend UI Redesign

## Overview

This plan rebuilds the CloudOps Agent frontend as a source project (React 18 + TypeScript + Vite) that produces a `dist/` folder deployable to AWS Amplify Hosting. The existing AIConversation component is replaced with custom chat components featuring typing indicators, progress states, and markdown rendering, while preserving AWS Amplify Auth, the AgentCore streaming invocation pattern, and localStorage configuration.

## Tasks

- [x] 1. Set up source project with tooling and dependencies
  - [x] 1.1 Initialize React 18 + TypeScript + Vite project
    - Run `npm create vite@latest` with React + TypeScript template in a new `frontend/` directory
    - Configure `vite.config.ts` with base path, build output to `dist/`
    - Set up `tsconfig.json` with strict mode, path aliases (`@/` → `src/`)
    - Create the directory structure: `src/components/`, `src/hooks/`, `src/services/`, `src/state/`, `src/styles/`, `src/__tests__/`
    - _Requirements: 1.1–1.8, 6.1_

  - [x] 1.2 Install core dependencies and configure package.json
    - Install runtime deps: `react`, `react-dom`, `@aws-amplify/ui-react`, `aws-amplify`, `@aws-sdk/client-bedrock-agent-core`, `react-markdown`, `rehype-sanitize`, `rehype-highlight`, `remark-gfm`, `uuid`
    - Install dev deps: `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `fast-check`, `jsdom`, `@types/react`, `@types/react-dom`, `@types/uuid`, `typescript`
    - Configure `vitest.config.ts` with jsdom environment, coverage thresholds, and setup files
    - Add scripts: `dev`, `build`, `preview`, `test`, `test:coverage`, `zip` (builds and zips dist/)
    - _Requirements: 1.1–1.8_

  - [x] 1.3 Create CSS custom properties theme and global styles
    - Create `src/styles/theme.css` with all CSS custom properties from design (colors, typography, spacing, radii, layout tokens)
    - Create `src/styles/reset.css` with minimal CSS reset (box-sizing, margin, font smoothing)
    - Create `src/styles/global.css` importing theme and reset, setting body/html to 100vh
    - Define responsive breakpoints (1024px) and media queries
    - Ensure all color pairs meet WCAG 4.5:1 contrast for normal text, 3:1 for large text
    - _Requirements: 1.1, 1.2, 1.8, 7.8_

- [x] 2. Implement service layer and state management
  - [x] 2.1 Create TypeScript interfaces and types
    - Create `src/types/index.ts` with all interfaces: `Message`, `ChatState`, `ChatAction`, `SessionState`, `AppConfig`, `AgentCoreResponse`, `ThemeTokens`
    - Export all types for use across components and services
    - _Requirements: 5.1, 5.2_

  - [x] 2.2 Implement ConfigManager service (localStorage)
    - Create `src/services/config.ts` with `getAppConfig()` reading from `localStorage.getItem("appConfig")`
    - Parse JSON and return typed `AppConfig` object
    - Throw descriptive error if config is missing
    - _Requirements: 5.2_

  - [x] 2.3 Implement SessionManager service
    - Create `src/services/session.ts` with `getOrCreateSession()` and `resetSession()`
    - Generate session IDs in format `agentcore-session-{timestamp}-{random}`
    - Store in sessionStorage (cleared on tab close/refresh)
    - _Requirements: 5.1, 5.3, 5.4_

  - [ ]\* 2.4 Write property test for SessionManager (Property 12)
    - **Property 12: Session IDs follow the expected format**
    - Verify all generated session IDs match `agentcore-session-{digits}-{alphanumeric}` pattern
    - Use fast-check to generate various timestamps and random seeds
    - **Validates: Requirements 5.1**

  - [x] 2.5 Implement AgentCoreService with streaming
    - Create `src/services/agentCore.ts` with `invokeAgent(prompt, sessionId, config, signal?)` function
    - Instantiate `BedrockAgentCoreClient` with credentials from Amplify Auth session
    - Send `InvokeAgentCoreRuntime` command, read stream via `response.getReader()`
    - Accumulate chunks, JSON.parse result, return `parsed.result`
    - Support AbortSignal for cancellation
    - _Requirements: 5.2, 3.6_

  - [ ]\* 2.6 Write property test for AgentCore request shape (Property 13)
    - **Property 13: Every API request includes session and user identifiers**
    - Mock the client and verify every invocation includes non-empty `runtimeSessionId` and valid JSON payload with `prompt` field
    - **Validates: Requirements 5.2**

  - [x] 2.7 Implement ChatReducer with all action types
    - Create `src/state/chatReducer.ts` with `chatReducer` function handling all `ChatAction` types
    - Handle: SEND_MESSAGE, RECEIVE_MESSAGE, SET_LOADING, SET_PROGRESS, SET_ERROR, CLEAR_MESSAGES, RETRY_MESSAGE
    - SEND_MESSAGE adds user message to array, RECEIVE_MESSAGE adds agent message
    - SET_ERROR clears loading/progress, RETRY stores original prompt
    - CLEAR_MESSAGES resets messages array
    - _Requirements: 3.1–3.8, 5.4_

  - [x] 2.8 Implement ChatContext provider
    - Create `src/state/ChatContext.tsx` with React Context + useReducer
    - Expose `messages`, `isLoading`, `progressMessage`, `error`, and action dispatchers
    - Wire `sendMessage` to call AgentCoreService and handle success/error/timeout
    - Implement 60-second timeout via AbortController + setTimeout
    - Implement retry by re-dispatching the original prompt
    - _Requirements: 3.1–3.8, 5.4_

- [x] 3. Checkpoint - Verify service layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement core UI components
  - [x] 4.1 Implement MessageInput component
    - Create `src/components/MessageInput/MessageInput.tsx` with auto-expanding textarea (1–5 lines)
    - Implement Enter to submit (non-empty, non-whitespace), Shift+Enter for newline
    - Enforce 2000-character limit, disable during loading
    - Add aria-label for accessibility, placeholder text per requirements
    - Create `src/components/MessageInput/MessageInput.module.css` with theme tokens
    - _Requirements: 2.1–2.7, 7.3, 7.5_

  - [ ]\* 4.2 Write property tests for MessageInput (Properties 1–4)
    - **Property 1: Textarea height bounded by line count** — verify height accommodates N+1 lines for N<5, caps at 5 lines for N≥5
    - **Property 2: Non-whitespace input submits on Enter** — verify trimmed value submitted and input cleared
    - **Property 3: Whitespace-only input prevents submission** — verify send disabled for whitespace-only
    - **Property 4: Character limit enforcement** — verify value never exceeds 2000 chars
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.7**

  - [x] 4.3 Implement TypingIndicator component
    - Create `src/components/TypingIndicator/TypingIndicator.tsx` with pulsing dots animation
    - Accept optional `progressMessage` prop to display below dots
    - Include `aria-label` that reflects current progress message
    - Create `src/components/TypingIndicator/TypingIndicator.module.css` with keyframe animation
    - _Requirements: 3.1, 3.2, 3.4, 7.6_

  - [x] 4.4 Implement useProgressState hook
    - Create `src/hooks/useProgressState.ts` with progress message cycling logic
    - Start showing progress after 3000ms delay, cycle every 4000ms through 5+ messages
    - Reset state when `isLoading` becomes false
    - _Requirements: 3.4, 3.5_

  - [ ]\* 4.5 Write property test for useProgressState (Property 5)
    - **Property 5: Progress state cycling with accessible label**
    - Verify for any elapsed time T > 3000ms, displayed message equals `MESSAGES[floor((T-3000)/4000) % MESSAGES.length]`
    - **Validates: Requirements 3.5, 7.6**

  - [x] 4.6 Implement MarkdownRenderer component
    - Create `src/components/MarkdownRenderer/MarkdownRenderer.tsx` using `react-markdown` with `remark-gfm` and `rehype-sanitize`
    - Add `rehype-highlight` for code syntax highlighting
    - Custom renderers: CodeBlock with copy button, table with alternating rows, links with `target="_blank" rel="noopener noreferrer"`
    - Style headings with descending size hierarchy (h1 largest → h6 smallest)
    - Style lists with consistent indentation per nesting level (up to 4 levels)
    - Create `src/components/MarkdownRenderer/MarkdownRenderer.module.css`
    - _Requirements: 4.1–4.10_

  - [ ]\* 4.7 Write property tests for MarkdownRenderer (Properties 6–11)
    - **Property 6: Heading size hierarchy** — h(N) font-size > h(N+1) font-size for all N
    - **Property 7: List indentation increases with nesting** — indentation at depth D > indentation at depth D-1
    - **Property 8: Table rows have alternating backgrounds** — even rows differ from odd rows
    - **Property 9: Links open in new tab** — all anchors have target="\_blank" rel="noopener noreferrer"
    - **Property 10: HTML sanitization** — script/iframe/event handler tags stripped
    - **Property 11: Malformed markdown graceful degradation** — any input produces non-empty DOM without exception
    - **Validates: Requirements 4.1, 4.2, 4.6, 4.7, 4.9, 4.10**

  - [x] 4.8 Implement CodeBlock sub-component
    - Create `src/components/MarkdownRenderer/CodeBlock.tsx` with syntax highlighting and copy-to-clipboard button
    - Show confirmation indicator ("Copied!") for 2 seconds after copy
    - Style with language label and monospace font
    - _Requirements: 4.4, 4.5_

- [x] 5. Checkpoint - Verify core components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement layout and message display components
  - [x] 6.1 Implement ChatLayout component
    - Create `src/components/ChatLayout/ChatLayout.tsx` as full-viewport flex container
    - Compose: Sidebar + main area (ChatHeader + MessageDisplay + MessageInput)
    - Use CSS Grid or Flexbox for full-height layout without page scroll
    - Create `src/components/ChatLayout/ChatLayout.module.css` with responsive breakpoints
    - _Requirements: 6.1–6.5_

  - [x] 6.2 Implement Sidebar component
    - Create `src/components/Sidebar/Sidebar.tsx` with collapsible navigation panel
    - Visible at ≥1024px viewport, collapsed to hamburger at <1024px
    - Slide-in overlay behavior on mobile with backdrop
    - Support Escape key to close
    - Create `src/components/Sidebar/Sidebar.module.css`
    - _Requirements: 6.2, 6.3, 7.1_

  - [x] 6.3 Implement ChatHeader component
    - Create `src/components/ChatHeader/ChatHeader.tsx` with app title, user avatar, "New Conversation" button, and hamburger menu icon (mobile)
    - "New Conversation" triggers session reset, message clear, and abort of in-flight requests
    - _Requirements: 1.3, 5.4, 6.3_

  - [x] 6.4 Implement MessageDisplay component
    - Create `src/components/MessageDisplay/MessageDisplay.tsx` as scrollable message list
    - Render UserMessage (right-aligned, user bubble color, avatar right) and AgentMessage (left-aligned, agent bubble color, avatar left)
    - Constrain message content width to 768px max, centered
    - Show TypingIndicator when loading, ScrollToBottom button when user scrolled up
    - _Requirements: 1.5–1.7, 5.5, 5.6, 6.4_

  - [x] 6.5 Implement useAutoScroll hook
    - Create `src/hooks/useAutoScroll.ts` with scroll detection (100px threshold) and smooth auto-scroll
    - Expose `containerRef`, `isUserScrolledUp`, `handleScroll`, `scrollToBottom`
    - Auto-scroll on new messages/loading changes unless user scrolled up
    - _Requirements: 5.5, 5.6_

  - [x] 6.6 Implement UserMessage and AgentMessage components
    - Create `src/components/MessageDisplay/UserMessage.tsx` — right-aligned bubble with user avatar
    - Create `src/components/MessageDisplay/AgentMessage.tsx` — left-aligned bubble with agent avatar, renders content via MarkdownRenderer
    - Create shared `src/components/MessageDisplay/MessageDisplay.module.css`
    - _Requirements: 1.5, 1.6, 1.7_

  - [x] 6.7 Implement ErrorMessage component
    - Create `src/components/ErrorMessage/ErrorMessage.tsx` with inline error display
    - Include retry button (resubmits original prompt) and cancel button
    - Announce error via aria-live="assertive" region
    - _Requirements: 3.6, 3.7, 3.8, 7.7_

  - [x] 6.8 Implement ScrollToBottom button component
    - Create `src/components/MessageDisplay/ScrollToBottom.tsx` — floating button shown when user scrolled up
    - Smooth scroll to bottom on click
    - _Requirements: 5.6_

- [x] 7. Checkpoint - Verify layout components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Wire application together with auth and entry point
  - [x] 8.1 Implement App component with Amplify Authenticator
    - Create `src/App.tsx` wrapping entire app with Amplify `Authenticator` component
    - Configure Amplify with Cognito settings from appConfig (userPoolId, userPoolClientId, identityPoolId)
    - Nest Context providers: ChatContext → App content
    - _Requirements: 5.2, 7.1_

  - [x] 8.2 Create main entry point and HTML template
    - Create `src/main.tsx` rendering App into `#root`
    - Update `index.html` template with proper meta tags, viewport settings, title "CloudOps Agent"
    - Import global styles (theme.css, reset.css, global.css)
    - _Requirements: 6.1, 6.5_

  - [x] 8.3 Implement keyboard navigation and focus management
    - Add Tab order through interactive elements: header controls → message display → input → send button
    - Visible 2px focus indicators on all interactive elements
    - Return focus to MessageInput after message submission
    - aria-live="polite" region for new agent messages
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

  - [ ]\* 8.4 Write property test for color contrast (Property 14)
    - **Property 14: Color contrast meets WCAG thresholds**
    - Verify all text/background pairs in theme have contrast ratio ≥ 4.5:1 for normal text, ≥ 3:1 for large text
    - **Validates: Requirements 7.8**

- [x] 9. Build verification and deployment packaging
  - [x] 9.1 Verify build produces correct output structure
    - Run `npm run build` and verify `dist/index.html` and `dist/assets/` are produced
    - Verify no build errors or TypeScript compilation failures
    - Add `zip` script to package.json that creates deployment zip from dist/
    - Verify the zip contains `index.html` at root level with `assets/` folder
    - _Requirements: 6.1_

  - [ ]\* 9.2 Write integration tests for full message flow
    - Test: submit message → typing indicator appears → mock response → message rendered with markdown
    - Test: submit → timeout after 60s → error with retry/cancel buttons
    - Test: submit → error response → inline error with retry
    - Test: "New Conversation" aborts in-flight request, clears messages, resets session
    - _Requirements: 3.1–3.8, 5.4_

- [x] 10. Final checkpoint - Full verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project is a NEW source directory (`frontend/`) that produces the same `dist/` output structure as the existing compiled zip
- All existing patterns (Amplify Auth, AgentCore streaming, localStorage config, session format) are preserved
- The `@aws-sdk/client-bedrock-agent-core` package name may need verification — use the actual published package name from npm

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5", "2.7"] },
    { "id": 4, "tasks": ["2.4", "2.6", "2.8"] },
    { "id": 5, "tasks": ["4.1", "4.3", "4.4", "4.6", "4.8"] },
    { "id": 6, "tasks": ["4.2", "4.5", "4.7"] },
    { "id": 7, "tasks": ["6.1", "6.5"] },
    { "id": 8, "tasks": ["6.2", "6.3", "6.4", "6.6", "6.7", "6.8"] },
    { "id": 9, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 10, "tasks": ["8.4", "9.1"] },
    { "id": 11, "tasks": ["9.2"] }
  ]
}
```
