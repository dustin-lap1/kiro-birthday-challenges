# Requirements Document

## Introduction

Day 5 of Kiro's birthday challenge week asks for a **custom Model Context Protocol (MCP) server** that connects Kiro to an external system and enables something Kiro cannot do on its own.

This feature is a local, stdio-based MCP server, written in **Node.js (ESM)**, that connects a Kiro workspace to **OpenAI's Images API** to give Kiro native-feeling image generation. It removes a recurring manual loop: today the user asks Kiro to draft an image prompt, copies it into ChatGPT, iterates there, then manually saves the resulting image back into the workspace so Kiro can see it. With this server, Kiro composes a prompt from its own conversation, project, and steering context, calls the tool, and the generated image is written **directly into a local workspace folder** — so Kiro immediately gains awareness of the file with no copy/paste round trip.

The server exposes a primary `generate_image` tool plus optional `edit_image` and `list_generated_images` tools. It authenticates with an `OPENAI_API_KEY` supplied through the environment, commits no secrets (providing a `.env.example` instead), and is registered through `.kiro/settings/mcp.json`. It can optionally read a local style/brand file and prepend it to every prompt so generated art stays on-brand automatically.

The deliverable also includes the self-contained `day-05-image-gen-mcp` challenge folder (README, MCP server code, `.kiro` folder, and env-var examples) matching the structure of prior challenge days, supporting the public GitHub submission.

## Glossary

- **Image_Gen_MCP_Server**: The custom Node.js (ESM) MCP server that connects Kiro to the OpenAI Images API and exposes image tools over a local stdio transport.
- **MCP_Host**: The Kiro workspace acting as the Model Context Protocol client that launches and communicates with the Image_Gen_MCP_Server.
- **OpenAI_Images_API**: The external OpenAI HTTP API used to generate and edit images.
- **Generate_Image_Tool**: The MCP tool named `generate_image` that produces a new image from a text prompt and writes it to the workspace.
- **Edit_Image_Tool**: The optional MCP tool named `edit_image` that produces an edit or variation of an existing local image.
- **List_Images_Tool**: The optional MCP tool named `list_generated_images` that reports an inventory of previously generated image files.
- **Image_Model**: An OpenAI image model the account can use; specifically `gpt-image-1` or `dall-e-3`.
- **Output_Directory**: The workspace-relative folder into which generated image files are written (default `public/images/`).
- **Workspace_Root**: The absolute root directory of the Kiro workspace that launched the Image_Gen_MCP_Server.
- **Style_Guide_File**: An optional local text file (for example `style-guide.md`) whose contents are prepended to every image prompt to keep generated art on-brand.
- **Effective_Prompt**: The final text sent to the OpenAI_Images_API, composed of the optional Style_Guide_File contents followed by the caller-supplied prompt.
- **API_Key**: The OpenAI credential read from the `OPENAI_API_KEY` environment variable.
- **Tool_Result**: The structured response the Image_Gen_MCP_Server returns to the MCP_Host after a tool call.
- **Saved_File_Path**: The path of an image file written to the Output_Directory, returned to the MCP_Host in the Tool_Result.
- **Challenge_Folder**: The self-contained `day-05-image-gen-mcp` directory containing the MCP server code, README, `.kiro` folder, and environment examples.
- **Supported_Size**: The set of image dimensions the Generate_Image_Tool accepts for the `size` parameter.
- **Supported_Quality**: The set of quality values the Generate_Image_Tool accepts for the `quality` parameter.
- **Default_Size**: The image size used when the caller omits the `size` parameter.
- **Default_Quality**: The quality value used when the caller omits the `quality` parameter.

## Requirements

### Requirement 1: MCP Server Registration and Startup

**User Story:** As a Kiro user, I want the image generation server to run as a local MCP server, so that Kiro can call image tools directly inside my workspace.

#### Acceptance Criteria

1. THE Image_Gen_MCP_Server SHALL communicate with the MCP_Host over a local stdio transport.
2. THE Image_Gen_MCP_Server SHALL implement the Model Context Protocol using the `@modelcontextprotocol/sdk` package.
3. WHEN the MCP_Host starts the Image_Gen_MCP_Server, THE Image_Gen_MCP_Server SHALL register the `generate_image` tool with its name, description, and input schema within 10 seconds of process start.
4. IF the Image_Gen_MCP_Server cannot complete startup or register the `generate_image` tool within 10 seconds of process start, THEN THE Image_Gen_MCP_Server SHALL terminate with a non-zero exit code and write an error to standard error indicating the startup or registration failure.
5. THE Challenge_Folder SHALL include an example `.kiro/settings/mcp.json` entry that launches the Image_Gen_MCP_Server as a Node.js ESM process.
6. WHEN the MCP_Host requests the list of available tools, THE Image_Gen_MCP_Server SHALL return a tool list containing the `generate_image` tool plus every optional tool whose enable flag is set, and excluding every optional tool whose enable flag is not set.
7. IF the MCP_Host sends a tool-list request before startup and registration have completed, THEN THE Image_Gen_MCP_Server SHALL respond with an error indicating the server is not yet ready and SHALL NOT return a partial tool list.

### Requirement 2: Authentication and Secret Handling

**User Story:** As a developer, I want the server to read my OpenAI key from the environment and never commit secrets, so that I can share the repository publicly and safely.

#### Acceptance Criteria

1. WHEN the Image_Gen_MCP_Server starts, THE Image_Gen_MCP_Server SHALL read the API_Key from the `OPENAI_API_KEY` environment variable.
2. IF the `OPENAI_API_KEY` environment variable is absent, empty, or contains only whitespace WHEN a tool that calls the OpenAI_Images_API is invoked, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing an error that states the `OPENAI_API_KEY` environment variable is required.
3. IF the `OPENAI_API_KEY` environment variable is absent, empty, or contains only whitespace WHEN a tool that calls the OpenAI_Images_API is invoked, THEN THE Image_Gen_MCP_Server SHALL NOT transmit any request to the OpenAI_Images_API.
4. THE Challenge_Folder SHALL include a `.env.example` file that lists `OPENAI_API_KEY` with a non-secret placeholder value.
5. THE Challenge_Folder SHALL exclude committed secret values through a `.gitignore` entry that ignores `.env` files.
6. WHEN the Image_Gen_MCP_Server writes log or error output, THE Image_Gen_MCP_Server SHALL exclude the complete API_Key value and any substring of the API_Key value from that output.

### Requirement 3: Image Generation and Local Save

**User Story:** As a Kiro user, I want a single tool that turns a prompt into a saved image file in my workspace, so that Kiro immediately sees the generated image without any copy or paste.

#### Acceptance Criteria

1. THE Generate_Image_Tool SHALL accept a `prompt` string parameter of 1 to 4000 characters, a `size` parameter, a `quality` parameter, an output directory parameter, and a `filename` parameter of 1 to 200 characters.
2. THE Generate_Image_Tool SHALL accept a `size` parameter whose value is a member of the Supported_Size set and a `quality` parameter whose value is a member of the Supported_Quality set.
3. IF the `prompt` parameter is missing, empty, or exceeds 4000 characters, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing a validation error naming the `prompt` parameter, and SHALL NOT call the OpenAI_Images_API.
4. IF the `size` parameter is provided and is not a member of the Supported_Size set, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing a validation error naming the `size` parameter, and SHALL NOT call the OpenAI_Images_API.
5. IF the `quality` parameter is provided and is not a member of the Supported_Quality set, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing a validation error naming the `quality` parameter, and SHALL NOT call the OpenAI_Images_API.
6. WHERE the caller omits the `size` parameter, THE Image_Gen_MCP_Server SHALL use the Default_Size.
7. WHERE the caller omits the `quality` parameter, THE Image_Gen_MCP_Server SHALL use the Default_Quality.
8. WHEN the Generate_Image_Tool is invoked with a valid prompt, THE Image_Gen_MCP_Server SHALL call the OpenAI_Images_API with the Effective_Prompt and the selected Image_Model.
9. WHEN the OpenAI_Images_API returns base64-encoded image data, THE Image_Gen_MCP_Server SHALL decode that data into binary PNG content.
10. WHEN the Image_Gen_MCP_Server has decoded the PNG content, THE Image_Gen_MCP_Server SHALL write the content as a PNG file into the Output_Directory.
11. IF the caller omits the output directory parameter, THEN THE Image_Gen_MCP_Server SHALL use `public/images/` relative to the Workspace_Root as the Output_Directory.
12. IF the caller omits the `filename` parameter, THEN THE Image_Gen_MCP_Server SHALL generate a filename that is unique within the Output_Directory.
13. IF a file already exists at the target Saved_File_Path, THEN THE Image_Gen_MCP_Server SHALL derive a non-matching filename within the Output_Directory rather than overwrite the existing file.
14. IF the Output_Directory does not exist WHEN a file is written, THEN THE Image_Gen_MCP_Server SHALL create the Output_Directory before writing the file.
15. WHEN the Image_Gen_MCP_Server has written the image file, THE Image_Gen_MCP_Server SHALL return a Tool_Result containing the Saved_File_Path.

### Requirement 4: Image Model Selection and Fallback

**User Story:** As a Kiro user, I want the server to use the best image model my account can access, so that I get the highest quality available without manual configuration.

#### Acceptance Criteria

1. THE Image_Gen_MCP_Server SHALL support the `gpt-image-1` Image_Model and the `dall-e-3` Image_Model.
2. WHERE the caller does not specify an Image_Model, THE Image_Gen_MCP_Server SHALL select `gpt-image-1` as the default Image_Model.
3. WHERE the caller specifies a supported Image_Model, THE Image_Gen_MCP_Server SHALL use the specified Image_Model for the request.
4. IF the caller specifies an Image_Model that is not `gpt-image-1` and is not `dall-e-3`, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing a validation error naming the supported Image_Models, and SHALL NOT call the OpenAI_Images_API.
5. IF a request using `gpt-image-1` is rejected because the account lacks access to that Image_Model, THEN THE Image_Gen_MCP_Server SHALL retry the request exactly once using `dall-e-3`.
6. IF the `dall-e-3` fallback request is also rejected because the account lacks access, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing a model-access error and SHALL NOT return image data.
7. WHEN a generation succeeds, THE Image_Gen_MCP_Server SHALL include the Image_Model actually used in the Tool_Result.

### Requirement 5: Context and Style Guide Injection

**User Story:** As a Kiro user, I want Kiro's context and an optional brand style guide folded into every prompt, so that generated images stay consistent with my project and brand.

#### Acceptance Criteria

1. THE Generate_Image_Tool SHALL accept the composed prompt text supplied by the MCP_Host as the caller-supplied prompt, accepting a caller-supplied prompt of 1 to 4000 characters and rejecting an empty caller-supplied prompt with an error indicating the prompt is required, without invoking image generation.
2. WHERE a Style_Guide_File is configured and readable and its contents are between 1 and 20000 characters, THE Image_Gen_MCP_Server SHALL form the Effective_Prompt by placing the Style_Guide_File contents first, followed by the caller-supplied prompt, separated by a blank line.
3. WHERE no Style_Guide_File is configured, THE Image_Gen_MCP_Server SHALL use the caller-supplied prompt as the Effective_Prompt.
4. IF a Style_Guide_File is configured but cannot be read within 5 seconds because it is missing, inaccessible, or unreadable WHEN a prompt is composed, THEN THE Image_Gen_MCP_Server SHALL use the caller-supplied prompt as the Effective_Prompt and include a warning in the Tool_Result indicating the style guide could not be applied, and SHALL still return a successful Tool_Result.
5. IF a configured Style_Guide_File is readable but its contents exceed 20000 characters, THEN THE Image_Gen_MCP_Server SHALL use the caller-supplied prompt as the Effective_Prompt and include a warning in the Tool_Result indicating the style guide exceeded the maximum allowed length and was not applied.
6. IF a configured Style_Guide_File is readable but empty, THEN THE Image_Gen_MCP_Server SHALL use the caller-supplied prompt as the Effective_Prompt and include a warning in the Tool_Result indicating the style guide was empty and was not applied.

### Requirement 6: Output Path Safety

**User Story:** As a developer, I want generated files confined to my workspace, so that a bad or malicious path cannot write files elsewhere on my machine.

#### Acceptance Criteria

1. WHEN the Image_Gen_MCP_Server receives an image generation request, THE Image_Gen_MCP_Server SHALL resolve the Output_Directory to a canonical absolute path, resolving all symbolic links and `.`/`..` segments, before writing any file.
2. IF the canonical resolved Output_Directory is not equal to the Workspace_Root and is not a descendant of the Workspace_Root, THEN THE Image_Gen_MCP_Server SHALL reject the request, write no file, and return a Tool_Result containing a path-safety error that identifies the rejected path.
3. IF the canonical resolved Saved_File_Path is not a descendant of the Workspace_Root, THEN THE Image_Gen_MCP_Server SHALL reject the request, write no file, and return a Tool_Result containing a path-safety error that identifies the rejected path.
4. IF the `filename` parameter contains a forward-slash (`/`) or backslash (`\`) path separator, or a parent-directory segment (`..`), THEN THE Image_Gen_MCP_Server SHALL reject the request, write no file, and return a Tool_Result containing a path-safety error indicating the invalid filename.
5. IF the `filename` parameter is empty, consists only of whitespace, or exceeds 255 characters, THEN THE Image_Gen_MCP_Server SHALL reject the request, write no file, and return a Tool_Result containing a validation error indicating the invalid filename.

### Requirement 7: Cost Awareness and Confirmation

**User Story:** As a Kiro user, I want the server to acknowledge that generation costs money and confirm what it did, so that I stay aware of paid usage and can find the result.

#### Acceptance Criteria

1. THE Generate_Image_Tool description SHALL state that invoking the tool performs a paid OpenAI_Images_API call.
2. WHEN a generation succeeds, THE Image_Gen_MCP_Server SHALL return a Tool_Result that includes the Saved_File_Path, the Image_Model used, and the requested size.
3. WHEN a generation succeeds, THE Image_Gen_MCP_Server SHALL return a Tool_Result containing a confirmation message that names the Saved_File_Path and the Image_Model used.
4. WHEN a generation succeeds, THE Image_Gen_MCP_Server SHALL return a Tool_Result that states a paid OpenAI_Images_API call was performed.

### Requirement 8: Error Handling

**User Story:** As a Kiro user, I want clear, specific errors when generation fails, so that I know how to fix the problem instead of seeing a crash.

#### Acceptance Criteria

1. IF the OpenAI_Images_API rejects the request because the API_Key is invalid, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result marked as an error containing an authentication error message, and SHALL NOT write an image file.
2. IF the OpenAI_Images_API rejects the request because the account lacks access to every supported Image_Model, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result marked as an error containing a model-access error message, and SHALL NOT write an image file.
3. IF the request to the OpenAI_Images_API does not return a response within 60 seconds or fails due to a network failure, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result marked as an error containing a network error message, and SHALL NOT write an image file.
4. IF a tool is invoked with a missing or invalid required parameter, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result marked as an error containing a validation error message that names the invalid parameter, and SHALL NOT send a request to the OpenAI_Images_API.
5. IF writing the image file fails, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result marked as an error containing a file-write error message that includes the attempted Saved_File_Path, and SHALL NOT leave a partial file.
6. IF the OpenAI_Images_API rejects the request for any other reason, including a rate-limit, a server-side error, or a content-policy rejection, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result marked as an error containing a message describing the failure.
7. WHEN the Image_Gen_MCP_Server returns any error Tool_Result, THE Image_Gen_MCP_Server SHALL continue running and SHALL accept and process a subsequent valid tool call without requiring a restart.

### Requirement 9: Edit Image Tool (Optional)

**User Story:** As a Kiro user, I want to edit or create variations of an existing local image, so that I can refine art without starting from scratch.

#### Acceptance Criteria

1. WHERE the Edit_Image_Tool is enabled, THE Image_Gen_MCP_Server SHALL register the `edit_image` tool with its name, description, and input schema.
2. THE Edit_Image_Tool SHALL accept a source image path parameter and a `prompt` parameter of 1 to 4000 characters describing the requested edit.
3. IF the source image path does not resolve to an existing file under the Workspace_Root, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing an error that names the missing source image, AND SHALL NOT write any output file.
4. IF the source image path resolves to a location outside the Workspace_Root, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing an error indicating the path is outside the workspace, AND SHALL NOT write any output file.
5. IF the `prompt` parameter is empty or exceeds 4000 characters, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing an error indicating the prompt is invalid, AND SHALL NOT write any output file.
6. IF the edit operation fails after the inputs are validated, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing an error indicating the edit could not be completed, AND SHALL NOT write any partial output file.
7. WHEN the Edit_Image_Tool succeeds, THE Image_Gen_MCP_Server SHALL write the resulting image into the Output_Directory and return a Tool_Result containing the Saved_File_Path.

### Requirement 10: List Generated Images Tool (Optional)

**User Story:** As a Kiro user, I want an inventory of generated images, so that I can see what already exists in my workspace.

#### Acceptance Criteria

1. WHERE the List_Images_Tool is enabled, THE Image_Gen_MCP_Server SHALL register the `list_generated_images` tool with its name, description, and input schema.
2. WHEN the List_Images_Tool is invoked AND the Output_Directory exists, THE Image_Gen_MCP_Server SHALL return a Tool_Result containing one entry per image file present in the Output_Directory, where each entry identifies the file by its file name.
3. WHEN the List_Images_Tool is invoked AND the Output_Directory contains no image files, THE Image_Gen_MCP_Server SHALL return a Tool_Result containing an empty list.
4. WHEN the List_Images_Tool returns two or more entries, THE Image_Gen_MCP_Server SHALL order the entries by file name in ascending lexicographic order.
5. IF the Output_Directory does not exist WHEN the List_Images_Tool is invoked, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result containing an empty list.
6. IF the Output_Directory exists but cannot be read WHEN the List_Images_Tool is invoked, THEN THE Image_Gen_MCP_Server SHALL return a Tool_Result indicating that the directory could not be read, and SHALL NOT terminate the server process.

### Requirement 11: Challenge Folder and Submission Artifacts

**User Story:** As the challenge submitter, I want a self-contained Day 5 folder with documentation and examples, so that the public repository satisfies the submission requirements.

#### Acceptance Criteria

1. THE Challenge_Folder SHALL reside at `day-05-image-gen-mcp` under the repository root, matching the layout of prior challenge days.
2. THE Challenge_Folder SHALL contain the Image_Gen_MCP_Server source code written in Node.js using ECMAScript modules, startable from within the Challenge_Folder without referencing files outside the folder other than its declared package dependencies.
3. THE Challenge_Folder SHALL contain a `README.md` that includes the external service the MCP server connects to, the setup steps to run it, the required environment variables, and at least one worked example of generating an image.
4. THE Challenge_Folder SHALL contain a `.kiro` configuration example that registers a named MCP server entry with its startup command and the names of its required environment variables.
5. THE Challenge_Folder SHALL contain a `.env.example` file that lists every required environment variable with a non-secret placeholder value.
6. IF a file is committed in the Challenge_Folder, THEN that file SHALL NOT expose a real API_Key value.
