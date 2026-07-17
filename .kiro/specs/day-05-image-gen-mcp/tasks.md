# Implementation Plan: Day 5 Image Generation MCP Server

## Overview

This plan builds the `day-05-image-gen-mcp` challenge folder as a local, stdio-based Node.js (ESM) MCP server that connects Kiro to OpenAI's Images API. The approach follows the design's "pure core + injected effects" architecture: pure, unit- and property-testable modules (config, validation, prompt composition, path safety, filenames, listing) are built first, then the effectful boundaries (OpenAI client, file writer), then the tool handlers that orchestrate them, and finally the protocol/entry layer that wires everything together over stdio. Submission artifacts (README, `.kiro` example config, `.env.example`, `.gitignore`) close out the work.

All 17 correctness properties from the design are turned into `fast-check` property tests (minimum 100 iterations each) placed next to the module they validate. Effects (`fetch`, `fs`, `realpath`, `now`) are injected so tests run fully in-memory with no real network or disk.

## Tasks

- [x] 1. Scaffold the challenge folder and MCP project skeleton
  - Create `day-05-image-gen-mcp/` at the repository root with `src/` and `src/tools/` directories
  - Add `package.json` with `"type": "module"`, a `test` script running `node --test`, the `@modelcontextprotocol/sdk` dependency, and `fast-check` as a dev dependency
  - Add empty ESM module stubs for `config.mjs`, `validation.mjs`, `promptComposer.mjs`, `pathSafety.mjs`, `filenames.mjs`, `openaiClient.mjs`, `fileWriter.mjs`, `imageLister.mjs`, and `index.mjs`, each exporting the signatures named in the design
  - Confirm `node --test` runs (with zero tests) from inside the folder
  - _Requirements: 11.1, 11.2_

- [x] 2. Implement configuration and supported value sets
  - [x] 2.1 Implement `config.mjs` with `loadConfig(env, cwd)` and `readApiKey(env)`
    - `loadConfig` assembles `workspaceRoot`, `defaultOutputDir` (`public/images`), `styleGuidePath`, `enableEditTool`, `enableListTool`, and `defaults` (Default_Size, Default_Quality, Default_Model) from injected `env`/`cwd`
    - `readApiKey` treats absent, empty, and whitespace-only `OPENAI_API_KEY` as missing, returning `{ ok:false, reason:"missing" }`, otherwise `{ ok:true, key }`
    - Export the Supported_Size and Supported_Quality sets and Default_Size/Default_Quality/Default_Model constants
    - _Requirements: 2.1, 3.6, 3.7, 4.2_

  - [x] 2.2 Write unit tests for `config.mjs`
    - Test API key read from env, and that absent/empty/whitespace keys are reported missing (Req 2.1)
    - Test enable flags and default output dir resolution
    - _Requirements: 2.1_

- [x] 3. Implement input validation
  - [x] 3.1 Implement `validation.mjs` with `validateGenerateInput` and `validateEditInput`
    - Validate in order: `prompt` present and 1–4000 chars; `size` ∈ Supported_Size if provided; `quality` ∈ Supported_Quality if provided; `model` ∈ {`gpt-image-1`,`dall-e-3`} if provided; `filename` well-formed (delegating to `filenames.mjs`)
    - Return a discriminated result `{ ok:true, value:NormalizedGenerateInput }` or `{ ok:false, error:ValidationError }` that names the offending parameter; never throw
    - Apply Default_Size, Default_Quality, and Default_Model when the corresponding parameter is omitted
    - `validateEditInput` performs the analogous prompt/source-path/filename checks for the edit tool
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.4, 5.1, 8.4, 9.2, 9.5_

  - [x] 3.2 Write property test for invalid prompt rejection
    - **Property 4: Invalid prompt is rejected without an API call**
    - **Validates: Requirements 3.3, 5.1, 8.4, 9.5**

  - [x] 3.3 Write property test for non-member enum rejection
    - **Property 5: Non-member enum values are rejected without an API call**
    - **Validates: Requirements 3.2, 3.4, 3.5, 4.1, 4.4, 8.4**

  - [x] 3.4 Write property test for defaulting of omitted optional parameters
    - **Property 6: Omitted optional parameters take their defaults**
    - **Validates: Requirements 3.6, 3.7, 4.2**

- [x] 4. Implement filename validation and unique-name derivation
  - [x] 4.1 Implement `filenames.mjs` with `validateFilename` and `deriveUniqueFilename`
    - `validateFilename` rejects names containing `/`, `\`, or a `..` segment, and names that are empty, whitespace-only, or longer than 255 characters
    - `deriveUniqueFilename(desiredName, existingNames, timestamp)` returns `desiredName` when it does not collide, otherwise appends a numeric/timestamp suffix before the extension until unique; generates a unique timestamped default (e.g. `image-<timestamp>-<n>.png`) when no name is supplied
    - _Requirements: 3.12, 3.13, 6.4, 6.5_

  - [x] 4.2 Write property test for filename validation
    - **Property 11: Filename validation**
    - **Validates: Requirements 6.4, 6.5**

  - [x] 4.3 Write property test for non-overwriting filename derivation
    - **Property 12: Filenames never overwrite existing files**
    - **Validates: Requirements 3.12, 3.13**

- [x] 5. Implement output path safety
  - [x] 5.1 Implement `pathSafety.mjs` with `resolveOutputDir`, `resolveSavePath`, and `isWithinWorkspace`
    - Canonicalize directories/paths via injected `realpath` (resolving symlinks and `.`/`..`) before any write; for a not-yet-created dir, canonicalize the nearest existing ancestor and append remaining segments
    - Accept a resolved path only if it equals or is a descendant of Workspace_Root; `isWithinWorkspace` uses `path.relative` and rejects results that are empty-with-different-root, start with `..`, or are absolute
    - Return `{ ok:true, canonical... }` or `{ ok:false, error:PathSafetyError }` identifying the rejected path
    - _Requirements: 6.1, 6.2, 6.3, 9.4_

  - [x] 5.2 Write property test for workspace containment
    - **Property 10: Writes stay within the workspace**
    - **Validates: Requirements 6.1, 6.2, 6.3, 9.4**

- [x] 6. Implement prompt composition with style-guide injection
  - [x] 6.1 Implement `promptComposer.mjs` with `composePrompt` and an injected `readStyleGuide`
    - `readStyleGuide(path, timeoutMs)` returns one of `{status:"none"}`, `{status:"ok",contents}`, `{status:"unreadable"}`, `{status:"too_long"}`, `{status:"empty"}` (5s read budget)
    - When status is `ok` with 1–20000 chars, `effectivePrompt = contents + "\n\n" + callerPrompt` and no warning; for `none`, use the caller prompt with no warning; for `unreadable`/`too_long`/`empty`, use the caller prompt and set the corresponding warning while keeping the result successful
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 6.2 Write property test for Effective_Prompt composition
    - **Property 8: Effective_Prompt composition**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**

- [x] 7. Implement the image listing module
  - [x] 7.1 Implement `imageLister.mjs` with `listImages(canonicalDir, readdir)`
    - Return image file names present in the directory, ordered ascending lexicographically, each identified by file name
    - A missing directory yields `{ ok:true, entries:[] }`; an unreadable directory yields `{ ok:false, error }` without terminating the process
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 7.2 Write property test for sorted image listing
    - **Property 17: Listing returns the sorted set of image files**
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5**

  - [x] 7.3 Write unit tests for lister edge cases
    - Missing directory returns empty list (Req 10.5); unreadable directory returns error without throwing (Req 10.6)
    - _Requirements: 10.5, 10.6_

- [x] 8. Checkpoint - Ensure all pure-core tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the OpenAI Images API client with model fallback
  - [x] 9.1 Implement `openaiClient.mjs` `generate` and `edit` with injected `fetch` and `now`
    - Call `POST /v1/images/generations` (and `/v1/images/edits` for `edit`) with a 60-second timeout, requesting base64 output; map model-specific size/quality values (e.g. `auto` quality → `standard` for `dall-e-3`)
    - Retry exactly once with `dall-e-3` when a `gpt-image-1` request is rejected for lack of account access; return a `model_access` error when the fallback is also access-rejected
    - Return `{ ok:true, model:usedModel, b64 }` or `{ ok:false, kind:ErrorKind, message }` where `ErrorKind` ∈ {auth, model_access, network, timeout, rate_limit, server, content_policy, other}, mapping HTTP 401/403-404/429/5xx/timeout/network/content-policy to the messages Requirement 8 requires
    - _Requirements: 4.3, 4.5, 4.6, 8.1, 8.2, 8.3, 8.6_

  - [x] 9.2 Write property test for model fallback and reported model
    - **Property 14: Model fallback and reported model**
    - **Validates: Requirements 4.5, 4.6, 4.7, 8.2**

- [x] 10. Implement the atomic file writer
  - [x] 10.1 Implement `fileWriter.mjs` `writeImageAtomic(canonicalPath, bytes, fs)`
    - Create the Output_Directory if absent, write to a temp file in the same directory, then rename into place so no partial file is left on failure
    - On failure return a file-write error including the attempted Saved_File_Path and remove any temp artifact
    - _Requirements: 3.10, 3.14, 8.5_

  - [x] 10.2 Write unit tests for the file writer
    - Directory created when absent; bytes read back equal input; simulated write failure leaves no partial file and returns the attempted path (Req 3.10, 3.14, 8.5)
    - _Requirements: 3.10, 3.14, 8.5_

- [x] 11. Implement the base64 decode helper
  - [x] 11.1 Add base64→PNG-bytes decoding used by the handlers
    - Decode API `b64_json` into binary PNG content prior to writing
    - _Requirements: 3.9_

  - [x] 11.2 Write property test for the base64 round-trip
    - **Property 9: base64 decode round-trip**
    - **Validates: Requirements 3.9**

- [x] 12. Implement the `generate_image` tool handler
  - [x] 12.1 Implement `tools/generateImage.mjs`
    - Orchestrate `config` (lazy `readApiKey`), `validation`, `promptComposer`, `pathSafety`, `filenames`, `openaiClient`, base64 decode, and `fileWriter`; always return a Tool_Result and never throw to the protocol layer
    - Return a missing-key error and skip the fetch when the API key is missing; on success return `structuredContent` with `savedFilePath`, `model` used, requested `size`, and `warnings`, plus a text confirmation naming the path and model and stating a paid OpenAI call was performed
    - The tool description states that invoking the tool performs a paid OpenAI Images API call
    - Map every failure to a structured error Tool_Result with the correct `errorKind` and ensure no image file is written on failure
    - _Requirements: 2.2, 2.3, 3.8, 3.11, 3.15, 4.3, 4.7, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

  - [x] 12.2 Write property test for missing API key blocking the network call
    - **Property 2: Missing API key blocks the network call**
    - **Validates: Requirements 2.2, 2.3**

  - [x] 12.3 Write property test for request carrying the Effective_Prompt and selected model
    - **Property 7: The request carries the Effective_Prompt and selected model**
    - **Validates: Requirements 3.8, 4.3**

  - [x] 12.4 Write property test for complete and honest success results
    - **Property 13: Successful results are complete and honest**
    - **Validates: Requirements 3.15, 7.2, 7.3, 7.4, 9.7**

  - [x] 12.5 Write property test for failure mapping without writing a file
    - **Property 15: Failures map to specific errors and never write a file**
    - **Validates: Requirements 8.1, 8.3, 8.5, 8.6, 9.6**

  - [x] 12.6 Write unit test for default output directory resolution
    - Omitted `outputDir` resolves under `public/images/` relative to Workspace_Root (Req 3.11)
    - _Requirements: 3.11_

- [x] 13. Implement the optional `edit_image` tool handler
  - [x] 13.1 Implement `tools/editImage.mjs`
    - Validate the source path resolves to an existing file inside the Workspace_Root and the `prompt` is 1–4000 chars; reject with a specific error and write no output otherwise
    - On success write the result into the Output_Directory and return a Tool_Result with the Saved_File_Path; on post-validation failure return an error and leave no partial file
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 13.2 Write unit tests for edit tool source-path handling
    - Missing source file and outside-workspace source path each return the correct error and write nothing (Req 9.3, 9.4)
    - _Requirements: 9.3, 9.4_

- [x] 14. Implement the optional `list_generated_images` tool handler
  - [x] 14.1 Implement `tools/listGeneratedImages.mjs`
    - Resolve the Output_Directory via `pathSafety` and return the sorted listing from `imageLister`; return an empty list for a missing directory and a directory-could-not-be-read error (without terminating) for an unreadable one
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 15. Implement the protocol/entry layer and secret redaction
  - [x] 15.1 Implement `index.mjs` with the MCP server, tool registry, and stdio transport
    - Build the tool list from `generate_image` plus each optional tool whose enable flag is set; register `ListToolsRequestSchema` and `CallToolRequestSchema` handlers and connect `StdioServerTransport`
    - Own the `ready` flag: mark ready only after handlers are registered and the transport is connected; respond to a pre-ready tool-list request with a not-ready error and no partial list
    - Arm a startup watchdog that writes a startup/registration failure to stderr and exits non-zero if not ready within 10 seconds
    - Wrap all stderr/log output in a redaction filter that strips the API-key value (and any substring) if it ever appears
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 2.6, 9.1, 10.1_

  - [x] 15.2 Write property test for the tool list reflecting enable flags
    - **Property 1: Tool list reflects enable flags**
    - **Validates: Requirements 1.6, 9.1, 10.1**

  - [x] 15.3 Write property test for API key never appearing in output
    - **Property 3: API key never appears in output**
    - **Validates: Requirements 2.6**

  - [x] 15.4 Write property test for server surviving every error
    - **Property 16: The server survives every error**
    - **Validates: Requirements 8.7**

  - [x] 15.5 Write unit test for pre-ready tool-list request
    - A tool-list request before ready returns a not-ready error and no partial list (Req 1.7)
    - _Requirements: 1.7_

- [x] 16. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Write lifecycle/integration tests over stdio
  - [x] 17.1 Write integration test for startup and tool advertisement
    - Server starts over stdio and advertises `generate_image` within the time budget (Req 1.1, 1.3)
    - _Requirements: 1.1, 1.3_

  - [x] 17.2 Write integration test for forced startup failure
    - A forced startup failure exits non-zero with a stderr message (Req 1.4)
    - _Requirements: 1.4_

  - [x] 17.3 Write end-to-end generate_image integration test against a stubbed endpoint
    - Writes a real PNG into a temp workspace and returns the confirmation result
    - _Requirements: 3.10, 3.15, 7.2_

- [x] 18. Create submission artifacts for the challenge folder
  - [x] 18.1 Create `README.md`, `.kiro/settings/mcp.json` example, `.env.example`, and `.gitignore`
    - `README.md`: name the external service (OpenAI Images API), setup steps, required env vars, and at least one worked `generate_image` example
    - `.kiro/settings/mcp.json`: register a named server entry launching the server as a Node.js ESM process, with the required env var names
    - `.env.example`: list `OPENAI_API_KEY` with a non-secret placeholder; `.gitignore`: ignore `.env`
    - _Requirements: 1.5, 2.4, 2.5, 11.3, 11.4, 11.5_

  - [x] 18.2 Write smoke/artifact checks
    - Assert folder layout, README sections, `mcp.json`, `.env.example`, and `.gitignore` `.env` entry are present and well-formed, and that no committed file contains a real API-key pattern (Req 1.5, 2.4, 2.5, 11.1–11.6)
    - _Requirements: 1.5, 2.4, 2.5, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they cover property tests, unit tests, integration tests, and smoke checks.
- Each of the 17 correctness properties from the design is implemented as a single `fast-check` property test (minimum 100 iterations), tagged with a `// Feature: day-05-image-gen-mcp, Property {n}: ...` comment, and placed next to the module it validates.
- Effects (`fetch`, `fs`, `realpath`, `now`) are injected so all property and unit tests run in-memory with no real network or disk.
- Transport wiring, startup timing, and artifact presence are covered by integration/smoke tests rather than property tests, per the design's testing strategy.
- Each task references specific requirement clauses for traceability, and every step builds on prior steps ending with the protocol layer wiring the modules together.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "4.1", "5.1", "6.1", "7.1", "9.1", "10.1", "11.1"] },
    { "id": 2, "tasks": ["2.2", "4.2", "4.3", "5.2", "6.2", "7.2", "7.3", "9.2", "10.2", "11.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "12.1", "14.1"] },
    { "id": 4, "tasks": ["12.2", "12.3", "12.4", "12.5", "12.6", "13.1"] },
    { "id": 5, "tasks": ["13.2", "15.1"] },
    { "id": 6, "tasks": ["15.2", "15.3", "15.4", "15.5", "18.1"] },
    { "id": 7, "tasks": ["17.1", "17.2", "17.3", "18.2"] }
  ]
}
```
